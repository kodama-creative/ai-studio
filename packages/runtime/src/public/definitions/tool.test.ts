import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import { defineTool, isToolDefinition } from "./tool";

describe("defineTool", () => {
  test("preserves a typed, framework-owned tool definition", async () => {
    const definition = defineTool({
      description: "Return demo weather.",
      inputSchema: Type.Object({ city: Type.String() }),
      outputSchema: Type.Object({ city: Type.String() }),
      execute: ({ city }, context) => ({
        city: `${city}:${context.toolName}:${context.callId}`,
      }),
    });

    expect(isToolDefinition(definition)).toBe(true);
    expect(
      await definition.execute(
        { city: "Shanghai" },
        {
          abortSignal: new AbortController().signal,
          callId: "call-1",
          toolName: "weather",
        }
      )
    ).toEqual({ city: "Shanghai:weather:call-1" });
  });

  test("rejects author-owned identity at typecheck", () => {
    const typecheck = () => {
      defineTool({
        description: "Valid.",
        inputSchema: Type.Object({}),
        execute: () => null,
        // @ts-expect-error tool identity is derived from its source path
        name: "author_owned",
      });
    };
    expect(typecheck).toBeFunction();
  });
});
