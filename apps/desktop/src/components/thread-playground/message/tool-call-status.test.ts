import { describe, expect, test } from "bun:test";

import { isToolCallPending } from "./tool-call-status";

describe("isToolCallPending", () => {
  test("includes only calls without a result or a prior remote attempt", () => {
    expect(
      isToolCallPending({
        id: "pending",
        input: { name: "weather", arguments: {} },
      })
    ).toBe(true);
    expect(
      isToolCallPending({
        id: "completed",
        input: { name: "weather", arguments: {} },
        output: { content: [{ type: "text", text: "sunny" }] },
      })
    ).toBe(false);
    expect(
      isToolCallPending({
        id: "outcome-unknown",
        input: { name: "weather", arguments: {} },
        attempt: { status: "started", at: "2026-07-15T00:00:00.000Z" },
      })
    ).toBe(false);
  });
});
