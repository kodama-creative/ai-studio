import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";

import { ToolCall, type ToolCall as ToolCallValue } from "./tools";

describe("ToolCall", () => {
  test("persists an MCP attempt marker independently from its result", () => {
    const toolCall = {
        id: "call-one",
        input: { name: "weather__forecast", arguments: {} },
        attempt: { status: "started", at: "2026-07-15T00:00:00.000Z" },
      } satisfies ToolCallValue;
    expect(Value.Check(ToolCall, toolCall)).toBe(true);
  });
});
