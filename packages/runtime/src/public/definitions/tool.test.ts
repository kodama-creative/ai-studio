import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import { defineTool, isToolDefinition } from "./tool";
import { defineDynamic } from "../tools/define-dynamic";

describe("defineTool", () => {
  test("preserves a typed, framework-owned tool definition", async () => {
    const definition = defineTool({
      description: "Return demo weather.",
      inputSchema: Type.Object({ city: Type.String() }),
      outputSchema: Type.Object({ city: Type.String() }),
      execute: ({ city }, context) => ({
        city: `${city}:${context.toolName}:${context.callId}`
      })
    });

    expect(isToolDefinition(definition)).toBe(true);
    expect(
      await definition.execute(
        { city: "Shanghai" },
        {
          abortSignal: new AbortController().signal,
          callId: "call-1",
          toolName: "weather",
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
      )
    ).toEqual({ city: "Shanghai:weather:call-1" });
  });

  test("preserves an Eve-shaped dynamic tool resolver", async () => {
    const definition = defineDynamic({
      events: {
        "turn.started": (_event, { session }) => ({
          echo: defineTool({
            description: "Echo the current Turn.",
            inputSchema: Type.Object({}),
            execute: () => ({ turnId: session.turn.id })
          })
        })
      }
    });

    const result = await definition.events["turn.started"](
      { type: "turn.started" },
      {
        session: {
          id: "session",
          auth: {
            initiator: {
              issuer: "test",
              principalId: "one",
              principalType: "user"
            },
            current: {
              issuer: "test",
              principalId: "one",
              principalType: "user"
            }
          },
          channel: { kind: "test" },
          turn: { id: "turn", sequence: 1 }
        }
      }
    );

    expect(result).toMatchObject({ echo: expect.any(Object) });
  });

  test("rejects author-owned identity at typecheck", () => {
    const typecheck = () => {
      defineTool({
        description: "Valid.",
        inputSchema: Type.Object({}),
        execute: () => null,
        // @ts-expect-error tool identity is derived from its source path
        name: "author_owned"
      });
    };
    expect(typecheck).toBeFunction();
  });
});
