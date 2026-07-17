import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { createOciBuildContext } from "./oci-build-context";
import { OCI_BUN_BASE_IMAGE } from "./oci/base-image-lock";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root => rm(root, { recursive: true })));
});

describe("createOciBuildContext", () => {
  test("emits a closed project-specific OCI build context", async () => {
    const root = await _root();
    const output = join(root, "context");
    const agentRoot = join(import.meta.dir, "../../../apps/example-agent/agent");

    const originalProviderKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "artifact-secret";
    let result: Awaited<ReturnType<typeof createOciBuildContext>>;
    try {
      result = await createOciBuildContext({ agentRoot, output });
    } finally {
      if (originalProviderKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalProviderKey;
      }
    }

    expect(result.output).toBe(output);
    expect(result.artifactFingerprint).toHaveLength(64);
    expect((await readdir(output)).sort()).toEqual([
      "Containerfile",
      "agent.bundle.mjs",
      "artifact.json",
      "bootstrap.mjs",
      "environment.json",
      "healthcheck.mjs"
    ]);
    const containerfile = await readFile(join(output, "Containerfile"), "utf8");
    expect(containerfile).toContain(
      "oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f"
    );
    expect(containerfile).toContain("USER 1000:1000");
    expect(containerfile).toContain('VOLUME ["/var/lib/llm-space"]');
    expect(containerfile).toContain("STOPSIGNAL SIGTERM");
    expect(containerfile).toContain(
      'ENTRYPOINT ["bun", "/opt/llm-space/bootstrap.mjs"]'
    );
    const environment = JSON.parse(
      await readFile(join(output, "environment.json"), "utf8")
    ) as {
      agent: Record<string, unknown>;
      host: Record<string, unknown>;
      schemaVersion: number;
    };
    expect(environment.schemaVersion).toBe(1);
    expect(Object.keys(environment.host).sort()).toEqual([
      "LLM_SPACE_SERVER_ALLOWED_HOSTS",
      "LLM_SPACE_SERVER_AUTH_KEYS",
      "LLM_SPACE_SERVER_CONTINUATION_TTL_SECONDS",
      "LLM_SPACE_SERVER_CORS_ORIGINS",
      "LLM_SPACE_SERVER_MAX_ACTIVE_RUNS",
      "LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS",
      "LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS"
    ]);
    expect(environment.agent).toEqual({
      OPENAI_API_KEY: { kind: "secret", required: true }
    });
    const contextText = await Promise.all(
      (await readdir(output)).map(async file => readFile(join(output, file), "utf8"))
    );
    expect(contextText.join("\n")).not.toContain("artifact-secret");
    expect(contextText.join("\n")).not.toContain(agentRoot);
    expect(Bun.version).toBe(OCI_BUN_BASE_IMAGE.version);
    expect(_externalImports(await readFile(join(output, "bootstrap.mjs"), "utf8")))
      .toEqual([]);
    expect(_externalImports(await readFile(join(output, "agent.bundle.mjs"), "utf8")))
      .toEqual([]);
  });

  test("is byte-deterministic across independent output directories", async () => {
    const root = await _root();
    const first = join(root, "first");
    const second = join(root, "second");
    const agentRoot = join(import.meta.dir, "../../../apps/example-agent/agent");

    await createOciBuildContext({ agentRoot, output: first });
    await createOciBuildContext({ agentRoot, output: second });

    const files = (await readdir(first)).sort();
    expect((await readdir(second)).sort()).toEqual(files);
    for (const file of files) {
      expect(await readFile(join(first, file))).toEqual(
        await readFile(join(second, file))
      );
    }
  });

  test("refuses to overwrite an existing output path", async () => {
    const root = await _root();
    const output = join(root, "owned.txt");
    await writeFile(output, "keep");

    const creation = createOciBuildContext({
      agentRoot: join(import.meta.dir, "../../../apps/example-agent/agent"),
      output
    });
    expect((await _rejection(creation)).message).toContain("Refusing to overwrite");
    expect(await readFile(output, "utf8")).toBe("keep");
  });

  test("scrubs Server credentials before the Agent bundle is imported", async () => {
    const root = await _root();
    const agentRoot = join(root, "agent");
    const output = join(root, "context");
    const marker = join(root, "agent-import.txt");
    await mkdir(agentRoot);
    await writeFile(
      join(agentRoot, "agent.ts"),
      `import { writeFileSync } from "node:fs";
      import { defineAgent } from "@llm-space/runtime";
      if (process.env.TEST_IMPORT_MARKER) {
        writeFileSync(
          process.env.TEST_IMPORT_MARKER,
          process.env.LLM_SPACE_SERVER_AUTH_KEYS === undefined ? "absent" : "present"
        );
        throw new Error("stop after credential-boundary assertion");
      }
      export default defineAgent({
        model: "openai/gpt-5.3-codex",
        environment: {
          OPENAI_API_KEY: { kind: "secret", required: true },
          TEST_IMPORT_MARKER: { kind: "config", required: true }
        }
      });`
    );
    await writeFile(join(agentRoot, "instructions.md"), "Test.\n");
    await createOciBuildContext({ agentRoot, output });

    const child = Bun.spawn([
      process.execPath,
      join(output, "bootstrap.mjs")
    ], {
      cwd: output,
      env: {
        ...process.env,
        LLM_SPACE_SERVER_ALLOWED_HOSTS: JSON.stringify(["agent.example"]),
        LLM_SPACE_SERVER_AUTH_KEYS: JSON.stringify([{
          issuer: "test",
          principalId: "principal",
          principalType: "service",
          token: "test-auth-token-with-at-least-thirty-two-bytes"
        }]),
        LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS: JSON.stringify(["127.0.0.1/32"]),
        OPENAI_API_KEY: "test-provider-key",
        TEST_IMPORT_MARKER: marker
      },
      stdout: "pipe",
      stderr: "pipe"
    });
    await child.exited;

    expect(await readFile(marker, "utf8")).toBe("absent");
    expect(await new Response(child.stderr).text()).not.toContain(
      "test-auth-token"
    );
  });

  test("rejects an artifact mismatch before authored code is imported", async () => {
    const root = await _root();
    const agentRoot = join(root, "agent");
    const output = join(root, "context");
    const marker = join(root, "agent-import.txt");
    await _writeImportMarkerAgent(agentRoot);
    await createOciBuildContext({ agentRoot, output });
    const artifactPath = join(output, "artifact.json");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
      fingerprints: { sources: { entries: Array<{ fingerprint: string; }>; }; };
    };
    artifact.fingerprints.sources.entries[0]!.fingerprint = "0".repeat(64);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = await _runBootstrap(output, marker);

    expect(result.exitCode).toBe(1);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(result.stderr).toBe(
      "Unable to start OCI Agent Server; verify declared environment and mounted storage.\n"
    );
  });

  test("validates Host configuration before authored code is imported", async () => {
    const root = await _root();
    const agentRoot = join(root, "agent");
    const output = join(root, "context");
    const marker = join(root, "agent-import.txt");
    await _writeImportMarkerAgent(agentRoot);
    await createOciBuildContext({ agentRoot, output });

    const result = await _runBootstrap(output, marker, {
      LLM_SPACE_SERVER_ALLOWED_HOSTS: "not-json"
    });

    expect(result.exitCode).toBe(1);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(result.stderr).not.toContain("test-auth-token");
  });

  test("rejects Agent declarations that collide with Host environment", async () => {
    const root = await _root();
    const agentRoot = join(root, "agent");
    const output = join(root, "context");
    await mkdir(agentRoot);
    await writeFile(
      join(agentRoot, "agent.ts"),
      `import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({
        model: "openai/gpt-5.3-codex",
        environment: {
          LLM_SPACE_SERVER_AUTH_KEYS: { kind: "secret", required: true }
        }
      });`
    );
    await writeFile(join(agentRoot, "instructions.md"), "Test.\n");

    const creation = createOciBuildContext({ agentRoot, output });
    expect((await _rejection(creation)).message).toContain(
      "cannot redefine Server Host input"
    );
    expect(await Bun.file(output).exists()).toBe(false);
    expect((await readdir(root)).sort()).toEqual(["agent"]);
  });

  test("rejects a declared runtime secret value embedded in authored code", async () => {
    const root = await _root();
    const agentRoot = join(root, "agent");
    const output = join(root, "context");
    const secret = "fixture-secret-that-must-not-enter-the-image";
    await mkdir(agentRoot);
    await writeFile(
      join(agentRoot, "agent.ts"),
      `import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({
        model: "openai/gpt-5.3-codex",
        environment: {
          EMBEDDED_SECRET: {
            kind: "secret",
            required: true,
            description: ${JSON.stringify(secret)}
          }
        }
      });`
    );
    await writeFile(join(agentRoot, "instructions.md"), "Test.\n");
    process.env.EMBEDDED_SECRET = secret;
    try {
      const creation = createOciBuildContext({ agentRoot, output });
      expect((await _rejection(creation)).message).toContain(
        "contains runtime secret value for EMBEDDED_SECRET"
      );
    } finally {
      delete process.env.EMBEDDED_SECRET;
    }
    expect(await Bun.file(output).exists()).toBe(false);
  });
});

async function _writeImportMarkerAgent(agentRoot: string): Promise<void> {
  await mkdir(agentRoot);
  await writeFile(
    join(agentRoot, "agent.ts"),
    `import { writeFileSync } from "node:fs";
    import { defineAgent } from "@llm-space/runtime";
    if (process.env.TEST_IMPORT_MARKER) {
      writeFileSync(process.env.TEST_IMPORT_MARKER, "imported");
    }
    export default defineAgent({
      model: "openai/gpt-5.3-codex",
      environment: {
        OPENAI_API_KEY: { kind: "secret", required: true },
        TEST_IMPORT_MARKER: { kind: "config", required: true }
      }
    });`
  );
  await writeFile(join(agentRoot, "instructions.md"), "Test.\n");
}

async function _runBootstrap(
  output: string,
  marker: string,
  overrides: Readonly<Record<string, string>> = {}
): Promise<{ exitCode: number; stderr: string; }> {
  const child = Bun.spawn([process.execPath, join(output, "bootstrap.mjs")], {
    cwd: output,
    env: {
      ...process.env,
      LLM_SPACE_SERVER_ALLOWED_HOSTS: JSON.stringify(["agent.example"]),
      LLM_SPACE_SERVER_AUTH_KEYS: JSON.stringify([{
        issuer: "test",
        principalId: "principal",
        principalType: "service",
        token: "test-auth-token-with-at-least-thirty-two-bytes"
      }]),
      LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS: JSON.stringify(["127.0.0.1/32"]),
      OPENAI_API_KEY: "test-provider-key",
      TEST_IMPORT_MARKER: marker,
      ...overrides
    },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text()
  ]);
  return { exitCode, stderr };
}

function _externalImports(source: string): string[] {
  const bunBuiltins = new Set(["node-fetch", "ws"]);
  const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/, "")));
  return new Bun.Transpiler({ loader: "js" }).scanImports(source)
    .map(imported => imported.path)
    .filter(specifier =>
      !specifier.startsWith("node:")
      && !specifier.startsWith("bun:")
      && !nodeBuiltins.has(specifier)
      && !bunBuiltins.has(specifier));
}

async function _root(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-oci-context-"));
  ROOTS.push(root);
  return root;
}

async function _rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}
