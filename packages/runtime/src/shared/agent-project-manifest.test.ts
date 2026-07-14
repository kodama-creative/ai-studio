import { describe, expect, test } from "bun:test";

import {
  AGENT_PROJECT_MANIFEST_VERSION,
  AgentProjectManifestError,
  parseAgentProjectManifest,
} from "./agent-project-manifest";

describe("Agent Project manifest", () => {
  test("parses the V1 manifest", () => {
    expect(
      parseAgentProjectManifest({
        schemaVersion: AGENT_PROJECT_MANIFEST_VERSION,
        agent: " ./src/agent ",
      })
    ).toEqual({ schemaVersion: 1, agent: "./src/agent" });
  });

  test("rejects unsupported or missing fields", () => {
    expect(() =>
      parseAgentProjectManifest({ schemaVersion: 2, agent: "agent" })
    ).toThrow(AgentProjectManifestError);
    expect(() => parseAgentProjectManifest({ schemaVersion: 1 })).toThrow(
      "non-empty relative agent path"
    );
  });
});
