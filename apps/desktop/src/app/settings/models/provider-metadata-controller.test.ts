import { describe, expect, test } from "bun:test";

import type { DesktopModelCatalogController } from "../../models/desktop-model-catalog-controller";

import {
  ProviderMetadataController,
  type ProviderMetadataTarget,
} from "./provider-metadata-controller";

interface TestOptions {
  readonly updateProvider: (
    providerId: string,
    patch: Parameters<DesktopModelCatalogController["updateProvider"]>[1]
  ) => Promise<void>;
  readonly saveFailed: (title: string, error: unknown) => void;
}

describe("ProviderMetadataController", () => {
  test("rolls a failed latest API intent back to the last successful intent", async () => {
    const first = _deferred<void>();
    const second = _deferred<void>();
    let writes = 0;
    const controller = _controller({
      updateProvider: () => {
        writes += 1;
        return writes === 1 ? first.promise : second.promise;
      },
    });

    controller.selectApi("anthropic-messages");
    controller.selectApi("openai-responses");
    first.resolve();
    await first.promise;
    await Promise.resolve();
    second.reject(new Error("second failed"));
    await _eventually(() => controller.getSnapshot().api, "anthropic-messages");

    expect(controller.getSnapshot().api).toBe("anthropic-messages");
  });

  test("rolls two failed API intents back to the authoritative value", async () => {
    const first = _deferred<void>();
    const second = _deferred<void>();
    let writes = 0;
    const failures: string[] = [];
    const controller = _controller({
      updateProvider: () => {
        writes += 1;
        return writes === 1 ? first.promise : second.promise;
      },
      saveFailed: (field) => failures.push(field),
    });

    controller.selectApi("anthropic-messages");
    controller.selectApi("openai-responses");
    first.reject(new Error("first failed"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    second.reject(new Error("second failed"));
    await _eventually(() => controller.getSnapshot().api, "openai-completions");

    expect(failures).toEqual(["Failed to update provider"]);
  });

  test("persists a return to the authoritative value behind an older intent", async () => {
    const first = _deferred<void>();
    const patches: unknown[] = [];
    const controller = _controller({
      updateProvider: (_providerId, patch) => {
        patches.push(patch);
        return patches.length === 1 ? first.promise : Promise.resolve();
      },
    });

    controller.draft("icon", "temporary");
    controller.commit("icon");
    controller.draft("icon", "");
    controller.commit("icon");
    first.resolve();
    await _eventually(() => patches.length, 2);

    expect(patches).toEqual([{ icon: "temporary" }, { icon: null }]);
    expect(controller.getSnapshot().icon).toBe("");
  });

  test("keeps a newer text Draft when an older save settles", async () => {
    const save = _deferred<void>();
    const controller = _controller({ updateProvider: () => save.promise });

    controller.draft("icon", "first");
    controller.commit("icon");
    controller.draft("icon", "still typing");
    save.reject(new Error("failed"));
    await save.promise.catch(() => undefined);
    await Promise.resolve();

    expect(controller.getSnapshot().icon).toBe("still typing");
  });

  test("normalizes text fields and rolls back to the last successful value", async () => {
    const second = _deferred<void>();
    let writes = 0;
    const patches: unknown[] = [];
    const controller = _controller({
      updateProvider: (_providerId, patch) => {
        patches.push(patch);
        writes += 1;
        return writes === 1 ? Promise.resolve() : second.promise;
      },
    });

    controller.draft("name", "  First  ");
    controller.commit("name");
    await _eventually(() => patches.length, 1);
    controller.draft("name", "Second");
    controller.commit("name");
    second.reject(new Error("failed"));
    await _eventually(() => controller.getSnapshot().name, "First");

    expect(patches).toEqual([{ name: "First" }, { name: "Second" }]);
  });

  test("authoritative sync updates idle fields without erasing a Draft", () => {
    const controller = _controller();
    controller.draft("icon", "draft-icon");

    controller.sync({
      providerId: "provider",
      name: "Remote name",
      api: "anthropic-messages",
      icon: "remote-icon",
    });

    expect(controller.getSnapshot()).toEqual({
      providerId: "provider",
      name: "Remote name",
      api: "anthropic-messages",
      icon: "draft-icon",
    });
  });

  test("retargeting skips queued work and ignores an old in-flight result", async () => {
    const oldSave = _deferred<void>();
    const writes: string[] = [];
    const failures: string[] = [];
    const controller = _controller({
      updateProvider: (providerId) => {
        writes.push(providerId);
        return providerId === "provider" ? oldSave.promise : Promise.resolve();
      },
      saveFailed: (field) => failures.push(field),
    });
    controller.selectApi("anthropic-messages");
    await _eventually(() => writes.includes("provider"), true);
    controller.draft("icon", "queued-old-icon");
    controller.commit("icon");

    controller.sync(_target("replacement"));
    controller.selectApi("anthropic-messages");
    oldSave.reject(new Error("obsolete"));
    await oldSave.promise.catch(() => undefined);
    await _eventually(() => writes.includes("replacement"), true);

    expect(writes).toEqual(["provider", "replacement"]);
    expect(failures).toEqual([]);
    expect(controller.getSnapshot().providerId).toBe("replacement");
  });
});

function _controller(
  overrides: Partial<TestOptions> = {}
): ProviderMetadataController {
  const options: TestOptions = {
    updateProvider: () => Promise.resolve(),
    saveFailed: () => undefined,
    ...overrides,
  };
  const controller = new ProviderMetadataController(
    { updateProvider: options.updateProvider },
    {
      error: options.saveFailed,
    }
  );
  controller.sync(_target("provider"));
  return controller;
}

function _target(providerId: string): ProviderMetadataTarget {
  return {
    providerId,
    name: `${providerId} name`,
    api: "openai-completions",
    icon: "",
  };
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (read() === expected) return;
    await Promise.resolve();
  }
  expect(read()).toBe(expected);
}
