import { describe, expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import {
  type ExternalAgentProjectThreadRecord,
  type ExternalAgentProjectView,
  getExternalAgentProjectRunBlockReason
} from "./external-agent-project";

const PROJECT = {
  id: "project-1",
  name: "Project",
  path: "/tmp/project",
  removable: true,
  status: "ready",
  threads: [],
  agentPath: "/tmp/project/agent",
  artifactFingerprint: "artifact-one",
  instructions: "Test",
  definition: {
    model: { provider: "openai", id: "gpt-5.3-codex" },
    reasoning: "high"
  },
  definitionFingerprint: "definition",
  promptFingerprint: "prompt",
  snapshot: "snapshot-2",
  sandboxRequired: false,
  tools: [],
  outputs: [],
  skills: [],
  diagnostics: [],
  sourceFiles: []
} satisfies ExternalAgentProjectView;

function _record(thread: Thread): ExternalAgentProjectThreadRecord {
  return {
    thread,
    promptFingerprint: "prompt",
    syncedPrompt: "Test",
    definitionFingerprint: "definition",
    syncedDefinition: PROJECT.definition
  };
}

describe("external Agent Project run gate", () => {
  test("makes a Direct Thread stale when current source requires Sandbox", () => {
    expect(getExternalAgentProjectRunBlockReason(
      { ...PROJECT, sandboxRequired: true },
      _record({ runtimeProfile: { version: 1, type: "desktopDirect" } })
    )).toBe("sandboxRequired");
  });

  test("blocks a new run while a frozen tool call still needs a result", () => {
    const record = _record({
      context: {
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: [],
            toolCalls: [
              {
                id: "call-1",
                input: { name: "lookup", arguments: {} }
              }
            ]
          },
          {
            id: "user-after-pending-call",
            role: "user",
            content: [{ type: "text", text: "A later editable message" }]
          }
        ]
      }
    });

    expect(getExternalAgentProjectRunBlockReason(PROJECT, record)).toBe(
      "pendingToolResult"
    );
  });

  test("blocks stale selected tools until they reconcile to the watched snapshot", () => {
    const record = _record({
      context: {
        tools: [
          {
            type: "project",
            name: "lookup",
            description: "Lookup",
            parameters: { type: "object", properties: {} },
            projectId: PROJECT.id,
            snapshot: "snapshot-1"
          }
        ]
      }
    });

    expect(getExternalAgentProjectRunBlockReason(PROJECT, record)).toBe(
      "staleToolSnapshot"
    );
    const [tool] = record.thread.context!.tools!;
    if (tool?.type !== "project") {
      throw new Error("expected project tool");
    }
    tool.snapshot = PROJECT.snapshot;
    expect(getExternalAgentProjectRunBlockReason(PROJECT, record)).toBeNull();
  });

  test("blocks every new run when watched source is invalid", () => {
    const record = _record({ context: {} });
    expect(
      getExternalAgentProjectRunBlockReason(
        { ...PROJECT, status: "invalid" },
        record
      )
    ).toBe("sourceUnavailable");
  });
});
