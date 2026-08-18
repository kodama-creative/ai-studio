import { resolve } from "node:path";

import type { PiAcpSessionBackend } from "@llm-space/acp/server";
import type { Agent } from "@llm-space/app/server";

/** Adapts the product-owned Agent API at the CLI's official ACP boundary. */
export function createAgentAcpBackend(
  agent: Agent,
  projectRoot: string
): PiAcpSessionBackend {
  const cwd = resolve(projectRoot);
  return {
    async create(request) {
      if (resolve(request.cwd) !== cwd) {
        throw new Error(`ACP Session cwd must be the Agent Project root: ${cwd}`);
      }
      const session = await agent.createSession();
      return (
        await agent.readCommitted({
          sessionId: session.sessionId,
          lane: session.lane,
        })
      ).snapshot;
    },
    async list(request) {
      if (request.cursor !== undefined && request.cursor !== null) {
        throw new Error("ACP Session list cursor is invalid for this endpoint.");
      }
      if (
        request.cwd !== undefined &&
        request.cwd !== null &&
        resolve(request.cwd) !== cwd
      ) {
        return { sessions: [] };
      }
      return {
        sessions: (await agent.listSessions()).map((session) => ({
          sessionId: session.sessionId,
          cwd,
          title: session.name,
          updatedAt: new Date(session.updatedAt).toISOString(),
        })),
      };
    },
    inspect: (request) => agent.readCommitted(request),
    async prompt(input) {
      return (
        await agent.exec(input.sessionId, {
          messages: input.messages,
          mode: input.driveMode,
          signal: input.signal,
        })
      ).snapshot;
    },
    step: (input) => agent.step(input),
    turn: (input) => agent.turn(input),
    continue: (input) => agent.continue(input),
    async abort(input) {
      await agent.abort(input.sessionId);
      return (await agent.readCommitted(input)).snapshot;
    },
    async closeSession(input) {
      await agent.abort(input.sessionId);
    },
  };
}
