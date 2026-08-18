import { describe, expect, test } from "bun:test";

import type {
  DurablePiRuntime,
  PiSessionSnapshot,
} from "@llm-space/pi-runtime";

import { DocumentExecutionEngine } from "./document-execution-engine";

describe("DocumentExecutionEngine", () => {
  test("turn runs one model and its consecutive tools, then stops at the next model", async () => {
    const actions = [
      { id: "model-1", kind: "model" as const, attempt: 1 },
      {
        id: "tool-1",
        kind: "tool" as const,
        assistantEntryId: "assistant-1",
        toolIndex: 0,
        toolCallId: "call-1",
        toolName: "read",
      },
      { id: "model-2", kind: "model" as const, attempt: 1 },
    ];
    const released: string[] = [];
    const runtime = {
      open: () => Promise.resolve(_snapshot(actions[0])),
      step: (input: { expectedActionId: string }) => {
        released.push(input.expectedActionId);
        const index = actions.findIndex(
          (action) => action.id === input.expectedActionId
        );
        return Promise.resolve(_snapshot(actions[index + 1]));
      },
    } as unknown as DurablePiRuntime;

    const engine = new DocumentExecutionEngine(runtime);
    const result = await engine.drive({
      sessionId: "session-1",
      operationId: "operation-1",
      mode: "turn",
    });

    expect(released).toEqual(["model-1", "tool-1"]);
    expect(result.nextAction?.id).toBe("model-2");
  });

  test("observe emits running before a Pi effect commits", async () => {
    let finishWatch: (() => void) | undefined;
    const runtime = {
      open: () => Promise.resolve(_snapshot({ id: "model-1", kind: "model", attempt: 1 })),
      step: () => Promise.resolve(_snapshot(undefined)),
      subscribe: () => () => undefined,
      async *watch() {
        yield* [];
        await new Promise<void>((resolve) => {
          finishWatch = resolve;
        });
      },
    } as unknown as DurablePiRuntime;
    const engine = new DocumentExecutionEngine(runtime);
    const iterator = engine.observe({ sessionId: "session-1" })[
      Symbol.asyncIterator
    ]();
    const event = iterator.next();
    await Promise.resolve();

    await engine.step({
      sessionId: "session-1",
      operationId: "operation-1",
      expectedActionId: "model-1",
      kind: "model",
    });

    expect((await event).value).toEqual({ type: "state", state: "running" });
    finishWatch?.();
    await iterator.return?.();
  });
});

function _snapshot(
  nextAction: PiSessionSnapshot["nextAction"]
): PiSessionSnapshot {
  return {
    cursor: 1,
    sessionId: "session-1",
    lane: "main",
    operationId: "operation-1",
    status: "paused",
    messageEntries: [],
    messages: [],
    leafId: null,
    ...(nextAction === undefined ? {} : { nextAction }),
  };
}
