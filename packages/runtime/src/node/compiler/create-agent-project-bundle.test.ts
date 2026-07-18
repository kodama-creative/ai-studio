import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";

import { createAgentProjectBundle } from "./create-agent-project-bundle";
import { loadAgentProject } from "./load-agent-project";
import { AgentSessionState } from "../../runtime/state/agent-session-state";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root => rm(root, { recursive: true })));
});

describe("createAgentProjectBundle", () => {
  test("builds the same Agent Artifact into an executable closed bundle", async () => {
    const root = await _fixture();
    const loaded = await loadAgentProject(root);

    const built = await createAgentProjectBundle(root);

    expect(built.artifact).toEqual(loaded.artifact);
    expect(built.environment).toEqual({
      PROVIDER_API_KEY: { kind: "secret", required: true }
    });
    expect(built.bundle).not.toContain(root);
    expect(built.bundle).not.toContain("sourceMappingURL");

    const bundlePath = join(root, "compiled-agent.mjs");
    await writeFile(bundlePath, built.bundle);
    const module = await import(`${pathToFileURL(bundlePath).href}?v=one`) as {
      createAgentProject(artifact: typeof built.artifact): ReturnType<
        typeof loadAgentProject
      > extends Promise<infer T> ? T : never;
    };
    const project = module.createAgentProject(built.artifact);
    expect(project.artifact).toEqual(built.artifact);
    expect(project.definition?.environment).toEqual(built.environment);
    expect(project.instructions).toBe(
      "Echo the input.\n\nKeep answers deterministic.\n\nUse typed static guidance."
    );
    expect(project.instructionEntries?.map(entry => ({
      kind: entry.kind,
      sourcePath: entry.sourcePath,
      ...(entry.kind === "static" ? { markdown: entry.markdown } : {})
    }))).toEqual(loaded.instructionEntries?.map(entry => ({
      kind: entry.kind,
      sourcePath: entry.sourcePath,
      ...(entry.kind === "static" ? { markdown: entry.markdown } : {})
    })));
    const dynamicInstructions = project.instructionEntries?.find(
      entry => entry.kind === "dynamic"
    );
    if (dynamicInstructions?.kind !== "dynamic") {
      throw new Error("Expected bundled dynamic instructions");
    }
    expect(await dynamicInstructions.definition.events["turn.started"](
      { type: "turn.started" },
      {
        session: {
          id: "bundle-session",
          auth: {
            initiator: {
              issuer: "test",
              principalId: "initiator",
              principalType: "user"
            },
            current: {
              issuer: "test",
              principalId: "current",
              principalType: "user"
            }
          },
          channel: { kind: "bundle" },
          turn: { id: "turn-bundle", sequence: 1 }
        }
      }
    )).toMatchObject({ markdown: "turn-bundle:current" });
    expect(project.tools.map(tool => tool.name)).toEqual(["echo"]);
    const dynamicTools = project.dynamicToolResolvers?.[0];
    expect(dynamicTools?.sourcePath).toBe("tools/tenant.ts");
    const resolvedDynamicTools = await dynamicTools?.definition.events[
      "turn.started"
    ](
      { type: "turn.started" },
      {
        session: {
          id: "bundle-session",
          auth: {
            initiator: {
              issuer: "test",
              principalId: "initiator",
              principalType: "user"
            },
            current: {
              issuer: "test",
              principalId: "current",
              principalType: "user"
            }
          },
          channel: { kind: "bundle" },
          turn: { id: "turn-bundle", sequence: 1 }
        }
      }
    );
    expect(resolvedDynamicTools).toMatchObject({
      tenant_echo: {
        __llmSpaceDynamicTool: {
          stepId: "dynamic-tool:tools/tenant.ts:0",
          closureVariables: { prefix: "bundle" }
        }
      }
    });
    expect(project.stateDefinitions).toEqual(loaded.stateDefinitions);
    expect(project.connections.map(connection => connection.name)).toEqual([
      "fixture"
    ]);
    const connection = project.connections[0]!.definition;
    const connectionContext = {
      abortSignal: new AbortController().signal,
      connectionName: "fixture",
      url: connection.url
    };
    expect(await connection.auth?.(connectionContext)).toEqual({
      token: "fixture-secret"
    });
    expect(
      typeof connection.headers === "function"
        ? await connection.headers(connectionContext)
        : connection.headers
    ).toEqual({ "X-Connection": "fixture" });
    expect(project.resources.skills?.map(skill => skill.name)).toEqual([
      "bundle-proof"
    ]);
    expect((await _executeInScope(
      async () => project.tools[0]!.execute("call", { value: "hello" })
    )).details)
      .toEqual({ value: "hello" });
    expect(() => module.createAgentProject({
      ...built.artifact,
      fingerprint: "0".repeat(64)
    })).toThrow("descriptor mismatch");
  });

  test("is deterministic across equivalent absolute project roots", async () => {
    const first = await _fixture();
    const second = await _fixture();

    const firstBuild = await createAgentProjectBundle(first);
    const secondBuild = await createAgentProjectBundle(second);

    expect(firstBuild.artifact).toEqual(secondBuild.artifact);
    expect(firstBuild.bundle).toBe(secondBuild.bundle);
  });

  test("bundles the same captured bytes when authored code edits its source", async () => {
    const root = await _fixture();
    const toolPath = join(root, "tools", "echo.ts");
    const source = `import { writeFileSync } from "node:fs";
      import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      writeFileSync(${JSON.stringify(toolPath)}, "changed after capture");
      export default defineTool({
        description: "Echo a value.",
        inputSchema: Type.Object({ value: Type.String() }),
        execute({ value }) { return { value }; }
      });`;
    await writeFile(toolPath, source);

    const built = await createAgentProjectBundle(root);

    expect(built.artifact.fingerprints.sources.entries).toContainEqual(
      expect.objectContaining({ id: "tools/echo.ts" })
    );
    expect(built.bundle).toContain("changed after capture");
  });

  test("rejects non-literal runtime imports in authored dependencies", async () => {
    const root = await _fixture();
    await writeFile(
      join(root, "tools", "echo.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Dynamic dependency fixture.",
        inputSchema: Type.Object({ value: Type.String() }),
        async execute({ value }) {
          const dependency = "./runtime-dependency";
          await import(dependency);
          return { value };
        }
      });`
    );

    const error = await _rejection(createAgentProjectBundle(root));

    expect(error.message).toContain("non-literal runtime import");
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-oci-bundle-"));
  ROOTS.push(root);
  await writeFile(
    join(root, "agent.ts"),
    `import { defineAgent } from "@llm-space/runtime";
    export default defineAgent({
      model: "openai/gpt-5.3-codex",
      environment: {
        PROVIDER_API_KEY: { kind: "secret", required: true }
      }
    });`
  );
  await writeFile(join(root, "instructions.md"), "Echo the input.\n");
  await mkdir(join(root, "instructions"));
  await writeFile(
    join(root, "instructions", "01-deterministic.md"),
    "Keep answers deterministic.\n"
  );
  await writeFile(
    join(root, "instructions", "02-typed.ts"),
    `import { defineInstructions } from "@llm-space/runtime/instructions";
    export default defineInstructions({ markdown: "Use typed static guidance." });`
  );
  await writeFile(
    join(root, "instructions", "03-turn.ts"),
    `import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
    export default defineDynamic({
      events: {
        "turn.started": (_event, { session }) => defineInstructions({
          markdown: session.turn.id + ":" + session.auth.current.principalId
        })
      }
    });`
  );
  await mkdir(join(root, "tools"));
  await writeFile(
    join(root, "tools", "tenant.ts"),
    `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
    import { Type } from "typebox";
    export default defineDynamic({
      events: {
        "turn.started": (_event, { session }) => {
          const prefix = session.channel.kind;
          return {
            tenant_echo: defineTool({
              description: "Echo with a captured tenant prefix.",
              inputSchema: Type.Object({ value: Type.String() }),
              execute({ value }) { return { value: prefix + ":" + value }; }
            })
          };
        }
      }
    });`
  );
  await writeFile(
    join(root, "tools", "echo.ts"),
    `import { defineTool } from "@llm-space/runtime/tools";
    import { Type } from "typebox";
    export default defineTool({
      description: "Echo a value.",
      inputSchema: Type.Object({ value: Type.String() }),
      outputSchema: Type.Object({ value: Type.String() }),
      execute({ value }) { return { value }; }
    });`
  );
  await mkdir(join(root, "connections"));
  await writeFile(
    join(root, "connections", "fixture.ts"),
    `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
    export default defineMcpClientConnection({
      url: "https://example.com/mcp",
      description: "Bundle callback proof.",
      auth: ({ connectionName }) => ({ token: connectionName + "-secret" }),
      headers: ({ connectionName }) => ({ "X-Connection": connectionName }),
      tools: { allow: ["remote_echo"] }
    });`
  );
  await mkdir(join(root, "state"));
  await writeFile(
    join(root, "state", "counter.ts"),
    `import { defineState } from "@llm-space/runtime/state";
    import { Type } from "typebox";
    export default defineState({
      name: "bundle.counter",
      version: 1,
      schema: Type.Object({ count: Type.Number() }),
      initial: { count: 0 }
    });`
  );
  await mkdir(join(root, "skills", "bundle-proof"), { recursive: true });
  await writeFile(
    join(root, "skills", "bundle-proof", "SKILL.md"),
    `---\nname: bundle-proof\ndescription: Proves skill bytes survive bundling.\n---\n\nProof.\n`
  );
  return root;
}

async function _executeInScope<T>(run: () => Promise<T>): Promise<T> {
  return new AgentSessionState({
    context: {
      id: "bundle-test-session",
      auth: {
        initiator: {
          issuer: "test",
          principalId: "test",
          principalType: "runtime"
        },
        current: {
          issuer: "test",
          principalId: "test",
          principalType: "runtime"
        }
      },
      channel: { kind: "test" },
      turn: { id: "turn-1", sequence: 1 }
    },
    definitions: []
  }).executeTool(run);
}

async function _rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}
