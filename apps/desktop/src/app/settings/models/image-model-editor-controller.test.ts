import { describe, expect, test } from "bun:test";

import type { SeedreamImageModelDefinition } from "@llm-space/core";

import { ImageModelEditorController } from "./image-model-editor-controller";

describe("ImageModelEditorController", () => {
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
    controller.open("original");

    expect(await controller.save(MODEL)).toMatchObject({
      type: "failed",
      error: new Error("save failed"),
    });
    expect(controller.getSnapshot().operation).toBe("idle");
    expect(await controller.save(MODEL)).toEqual({ type: "saved" });
  });

  test("binds Save to the original model identity", async () => {
    const save = _deferred<void>();
    const calls: unknown[][] = [];
    const controller = _controller({
      save: (...args) => {
        calls.push(args);
        return save.promise;
      },
    });
    controller.open("original");
    const first = controller.save(MODEL);

    expect(await controller.save(MODEL)).toEqual({ type: "ignored" });
    expect(calls).toEqual([[MODEL, "original"]]);
    save.resolve();
    expect(await first).toEqual({ type: "saved" });
  });

  test("ignores an old failure after close and same-target reopen", async () => {
    const oldSave = _deferred<void>();
    const newSave = _deferred<void>();
    let attempts = 0;
    const controller = _controller({
      save: () => {
        attempts += 1;
        return attempts === 1 ? oldSave.promise : newSave.promise;
      },
    });
    controller.open("same");
    const oldResult = controller.save(MODEL);

    controller.closeSession();
    controller.open("same");
    const newResult = controller.save(MODEL);
    oldSave.reject(new Error("late failure"));

    expect(await oldResult).toEqual({ type: "ignored" });
    expect(controller.getSnapshot().operation).toBe("saving");
    newSave.resolve();
    expect(await newResult).toEqual({ type: "saved" });
  });
});

const MODEL: SeedreamImageModelDefinition = {
  id: "model",
  name: "Model",
  supportedSizes: ["2K"],
  defaultSize: "2K",
};

function _controller(
  overrides: Partial<
    ConstructorParameters<typeof ImageModelEditorController>[0]
  > = {}
) {
  return new ImageModelEditorController({
    save: () => Promise.resolve(),
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
