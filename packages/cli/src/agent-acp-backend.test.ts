import { expect, test } from "bun:test";

import type { Agent } from "@llm-space/app/server";

import { createAgentAcpBackend } from "./agent-acp-backend";

test("CLI ACP adapter scopes create and list to its Agent Project cwd", async () => {
  const sessions: {
    readonly sessionId: string;
    readonly lane: "main";
    readonly name: string;
    readonly updatedAt: number;
  }[] = [];
  const agent = {
    createSession() {
      const session = {
        sessionId: "session-1",
        lane: "main" as const,
        name: "New Session",
        updatedAt: 1,
      };
      sessions.push(session);
      return Promise.resolve(session);
    },
    listSessions: () => Promise.resolve(sessions),
    readCommitted: ({ sessionId }: { readonly sessionId: string }) =>
      Promise.resolve({
        fromCursor: 0,
        cursor: 0,
        items: [],
        snapshot: {
          sessionId,
          lane: "main",
          cursor: 0,
          status: "completed" as const,
          messageEntries: [],
          messages: [],
          leafId: null,
        },
      }),
  } as unknown as Agent;
  const backend = createAgentAcpBackend(agent, "/project/agent");

  expect(
    backend.create({ cwd: "/project/other", mcpServers: [] })
  ).rejects.toThrow("ACP Session cwd must be the Agent Project root");
  expect(await backend.list({ cwd: "/project/other" })).toEqual({
    sessions: [],
  });
  expect(backend.list({ cursor: "unsupported" })).rejects.toThrow(
    "ACP Session list cursor is invalid"
  );

  const created = await backend.create({
    cwd: "/project/agent",
    mcpServers: [],
  });
  expect(
    (await backend.list({ cwd: "/project/agent" })).sessions
  ).toMatchObject([
    { sessionId: created.sessionId, cwd: "/project/agent" },
  ]);
});
