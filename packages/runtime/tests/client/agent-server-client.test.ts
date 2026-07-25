import { createAgentServerClient } from "@llm-space/runtime/client";
import { describe, expect, test } from "bun:test";

describe("Agent Server Runtime authority client", () => {
  test("sends the selected working base and authenticates branch rename", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string; }> = [];
    const client = createAgentServerClient({
      authorization: "Bearer local-test",
      baseUrl: "https://agent.example",
      fetch: (async (input, init) => {
        const url = input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
        requests.push({
          body: typeof init?.body === "string"
            ? JSON.parse(init.body) as unknown
            : null,
          headers: new Headers(init?.headers),
          url
        });
        if (url.endsWith("/branches/branch-1")) {
          return Response.json(_runtimeSession());
        }
        return Response.json({
          schemaVersion: 1,
          sessionId: "session-one",
          runId: "run-one"
        }, { status: 202 });
      }) as typeof globalThis.fetch
    });

    await client.createRun({
      continuationToken: "continuation-one",
      idempotencyKey: "run-request-one",
      sessionId: "session-one",
      text: "continue from history",
      workingBase: {
        branchId: "branch-1",
        checkpointId: "run-base:checkpoint:1"
      }
    });
    await client.renameBranch({
      branchId: "branch-1",
      continuationToken: "continuation-one",
      label: "Investigation",
      sessionId: "session-one"
    });

    expect(requests[0]?.body).toEqual({
      input: { type: "text", text: "continue from history" },
      workingBase: {
        branchId: "branch-1",
        checkpointId: "run-base:checkpoint:1"
      }
    });
    expect(requests[1]).toMatchObject({
      body: { label: "Investigation" },
      url: "https://agent.example/v1/sessions/session-one/branches/branch-1"
    });
    expect(requests[1]?.headers.get("llm-space-continuation"))
      .toBe("continuation-one");
  });
});

function _runtimeSession() {
  return {
    version: 1,
    snapshot: {
      schemaVersion: 4,
      id: "session-one",
      activeRunId: null,
      runs: [],
      history: {
        schemaVersion: 1,
        branches: [],
        checkpoints: [],
        compactions: [],
        currentBranchId: null,
        currentCheckpointId: null,
        entries: []
      }
    },
    configurations: [],
    journal: []
  };
}
