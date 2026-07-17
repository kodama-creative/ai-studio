import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_PROJECT_PRESETS,
  type AgentProjectPreset
} from "@llm-space/runtime";
import {
  loadAgentProject,
  loadAgentProjectManifest,
  scaffoldAgentProject
} from "@llm-space/runtime/node";
import { afterEach, describe, expect, test } from "bun:test";

import { createOciBuildContext } from "./oci-build-context";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

function _root() {
  const root = path.join(tmpdir(), `llm-space-cli-${crypto.randomUUID()}`);
  roots.push(root);
  return root;
}

describe("scaffoldAgentProject", () => {
  for (let mask = 0; mask < (1 << AGENT_PROJECT_PRESETS.length); mask += 1) {
    const presets = AGENT_PROJECT_PRESETS.filter(
      (_preset, index) => Boolean(mask & (1 << index))
    );
    test(
      `generates and builds ${_label(presets)}`,
      async () => {
        const parent = _root();
        await mkdir(parent);
        const root = path.join(parent, `agent-${mask}`);
        await scaffoldAgentProject({
          directory: root,
          presets,
          ...(presets.includes("mcp-connection")
            ? {
              mcpConnection: {
                url: "https://mcp.example.test/tools",
                tools: ["remote_echo"]
              }
            }
            : {})
        });
        const resolved = await loadAgentProjectManifest(root);
        const snapshot = await loadAgentProject(resolved.agentRoot);
        expect(snapshot.diagnostics).toEqual([]);
        expect(snapshot.definition).toEqual({
          model: { provider: "openai", id: "gpt-5.3-codex" },
          reasoning: "high",
          environment: {
            OPENAI_API_KEY: { kind: "secret", required: true }
          }
        });
        expect(snapshot.tools.map(tool => tool.name)).toEqual(
          presets.includes("local-tool") ? ["echo"] : []
        );
        expect(snapshot.resources.skills?.map(skill => skill.name) ?? []).toEqual(
          presets.includes("skill") ? ["concise-response"] : []
        );
        expect(snapshot.connections.map(connection => ({
          name: connection.name,
          url: connection.definition.url,
          allow: connection.definition.tools.allow
        }))).toEqual(
          presets.includes("mcp-connection")
            ? [{
              name: "remote",
              url: "https://mcp.example.test/tools",
              allow: ["remote_echo"]
            }]
            : []
        );
        if (presets.includes("local-tool")) {
          const result = await snapshot.tools[0]!.execute("scaffold-test", {
            text: "hello"
          });
          expect(result.details).toEqual({ text: "hello" });
        }
        const output = path.join(parent, `oci-${mask}`);
        const built = await createOciBuildContext({
          agentRoot: resolved.agentRoot,
          output
        });
        expect(built.artifactFingerprint).toBe(snapshot.artifact.fingerprint);
        expect(await readdir(output)).toContain("Containerfile");
      },
      60_000
    );
  }
});

function _label(presets: readonly AgentProjectPreset[]): string {
  return presets.length > 0 ? presets.join(" + ") : "canonical base";
}
