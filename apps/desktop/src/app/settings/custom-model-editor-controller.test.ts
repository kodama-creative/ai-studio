import { describe, expect, test } from "bun:test";

import type { CustomModel } from "@llm-space/core";

import { CustomModelEditorController } from "./custom-model-editor-controller";

describe("CustomModelEditorController", () => {
  test("contains a failed save and keeps the current session retryable", async () => {
    let attempts = 0;
    const controller = _controller({
      save: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("save failed"))
          : Promise.resolve();
      },
    });
    controller.open(_target("alpha"));

    expect(await controller.save(MODEL)).toMatchObject({
      type: "failed",
      error: new Error("save failed"),
    });
    expect(controller.getSnapshot().operation).toBe("idle");
    expect(await controller.save(MODEL)).toEqual({ type: "saved" });
  });

  test("ignores an old completion without settling the replacement session", async () => {
    const oldSave = _deferred<void>();
    const newTest = _deferred<void>();
    const controller = _controller({
      save: () => oldSave.promise,
      test: () => newTest.promise,
    });
    controller.open(_target("old"));
    const staleResult = controller.save(MODEL);

    controller.close();
    controller.open(_target("new"));
    const currentResult = controller.test(MODEL);
    oldSave.resolve();
    expect(await staleResult).toEqual({ type: "ignored" });
    expect(controller.getSnapshot().operation).toBe("testing");

    newTest.resolve();
    expect(await currentResult).toEqual({ type: "tested" });
    expect(controller.getSnapshot().operation).toBe("idle");
  });

  test("ignores an old rejection after the editor closes", async () => {
    const save = _deferred<void>();
    const controller = _controller({ save: () => save.promise });
    controller.open(_target("old"));
    const staleResult = controller.save(MODEL);

    controller.close();
    save.reject(new Error("late failure"));

    expect(await staleResult).toEqual({ type: "ignored" });
    expect(controller.getSnapshot().operation).toBe("idle");
  });

  test("admits only one effect and binds it to the frozen target", async () => {
    const save = _deferred<void>();
    const calls: unknown[][] = [];
    const controller = _controller({
      save: (...args) => {
        calls.push(args);
        return save.promise;
      },
    });
    controller.open({
      providerId: "provider",
      profileId: "profile",
      originalModelId: "original",
    });
    const first = controller.save(MODEL);

    expect(await controller.test(MODEL)).toEqual({ type: "ignored" });
    expect(calls).toEqual([["provider", MODEL, "original"]]);
    save.resolve();
    expect(await first).toEqual({ type: "saved" });
  });
});

const MODEL: CustomModel = {
  id: "model",
  name: "Model",
  api: "openai-responses",
  reasoning: false,
  input: ["text"],
  contextWindow: 1024,
  maxTokens: 512,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function _target(providerId: string) {
  return { providerId, profileId: "profile" };
}

function _controller(
  overrides: Partial<
    ConstructorParameters<typeof CustomModelEditorController>[0]
  > = {}
) {
  return new CustomModelEditorController({
    save: () => Promise.resolve(),
    test: () => Promise.resolve(),
    ...overrides,
  });
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}
