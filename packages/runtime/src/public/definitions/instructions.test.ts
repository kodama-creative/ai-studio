import { describe, expect, test } from "bun:test";

import { defineDynamic } from "./define-dynamic";
import { defineInstructions } from "./define-instructions";

describe("instruction definitions", () => {
  test("brands static output and preserves typed turn context", async () => {
    const dynamic = defineDynamic({
      events: {
        "turn.started": (_event, context) => defineInstructions({
          markdown: `Principal: ${context.session.auth.current.principalId}`
        })
      }
    });
    const result = await dynamic.events["turn.started"](
      { type: "turn.started" },
      {
        session: {
          id: "session-1",
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
          channel: { kind: "test" },
          turn: { id: "turn-1", sequence: 1 }
        }
      }
    );
    expect(result).toEqual({ markdown: "Principal: current" });
  });
});
