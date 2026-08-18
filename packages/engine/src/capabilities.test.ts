import { describe, expect, test } from "bun:test";

import type { AgentManifest } from "@llm-space/agent/loader";

import {
  UnsupportedAgentCapabilitiesError,
  validateAgentCapabilities,
} from "./capabilities";

describe("validateAgentCapabilities", () => {
  test("fails with structured paths for channels and schedules", () => {
    const manifest = _manifest({
      channels: [
        {
          name: "api",
          sourceId: "channels/api.ts",
          logicalPath: "channels/api.ts",
          sourceKind: "module",
          routes: [],
        },
      ],
      schedules: [
        {
          name: "daily",
          sourceId: "schedules/daily.md",
          logicalPath: "schedules/daily.md",
          sourceKind: "markdown",
          cron: "0 0 * * *",
          hasRun: false,
        },
      ],
    });

    expect(() => validateAgentCapabilities(manifest)).toThrow(
      UnsupportedAgentCapabilitiesError
    );
    try {
      validateAgentCapabilities(manifest);
    } catch (error) {
      const failure = error as UnsupportedAgentCapabilitiesError;
      expect(failure.code).toBe("unsupported_agent_capabilities");
      expect(failure.capabilities.map((item) => item.kind)).toEqual([
        "channel",
        "schedule",
      ]);
      expect(failure.capabilities[0]?.sourcePath).toBe("channels/api.ts");
    }
  });

  test("accepts the capabilities implemented by the Pi host", () => {
    expect(() => validateAgentCapabilities(_manifest())).not.toThrow();
  });
});

function _manifest(
  overrides: Partial<AgentManifest> = {}
): AgentManifest {
  return {
    kind: "llm-space-agent-manifest",
    agentId: "test-agent",
    agent: { model: "test/model" },
    channels: [],
    connections: [],
    extensions: [],
    hooks: [],
    instructions: [],
    sandboxWorkspace: [],
    schedules: [],
    skills: [],
    tools: [],
    subagents: [],
    ...overrides,
  };
}
