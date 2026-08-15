import { describe, expect, test } from "bun:test";

import type { ModelProviderGroup } from "@llm-space/core";

import {
  AddProviderController,
  type AddProviderControllerOptions,
} from "./add-provider-controller";

describe("AddProviderController", () => {
  test("ignores discovery completed after close", async () => {
    const discovery = _deferred<ModelProviderGroup[]>();
    const controller = _controller({
      fetchBuiltinProviders: () => discovery.promise,
    });

    controller.setOpen(true);
    controller.setOpen(false);
    discovery.resolve([_provider("late")]);
    await discovery.promise;
    await Promise.resolve();

    expect(controller.getSnapshot()).toEqual(_closedSnapshot());
  });

  test("a reopened session cannot be overwritten by older discovery", async () => {
    const first = _deferred<ModelProviderGroup[]>();
    let reads = 0;
    const controller = _controller({
      fetchBuiltinProviders: () => {
        reads += 1;
        return reads === 1
          ? first.promise
          : Promise.resolve([_provider("latest")]);
      },
    });

    controller.setOpen(true);
    controller.setOpen(false);
    controller.setOpen(true);
    await _eventually(
      () => controller.getSnapshot().builtinProviders?.[0]?.id,
      "latest"
    );
    first.resolve([_provider("stale")]);
    await Promise.resolve();

    expect(controller.getSnapshot().builtinProviders?.[0]?.id).toBe("latest");
  });

  test("contains discovery failures in the current snapshot", async () => {
    const controller = _controller({
      fetchBuiltinProviders: () => Promise.reject(new Error("offline")),
    });

    controller.setOpen(true);
    await _eventually(() => controller.getSnapshot().discoveryFailed, true);

    expect(controller.getSnapshot().builtinProviders).toEqual([]);
  });

  test("adds one builtin provider, selects it, and closes", async () => {
    const addition = _deferred<void>();
    const additions: string[] = [];
    const selections: string[] = [];
    const controller = _controller({
      addBuiltinProvider: (providerId) => {
        additions.push(providerId);
        return addition.promise;
      },
      providerAdded: (providerId) => selections.push(providerId),
    });
    controller.setOpen(true);

    const first = controller.choose({
      type: "builtin",
      provider: _provider("alpha"),
    });
    await controller.choose({
      type: "builtin",
      provider: _provider("beta"),
    });

    expect(additions).toEqual(["alpha"]);
    expect(controller.getSnapshot().addingProviderId).toBe("alpha");
    addition.resolve();
    await first;

    expect(selections).toEqual(["alpha"]);
    expect(controller.getSnapshot()).toEqual(_closedSnapshot());
  });

  test("a custom provider reports its generated id", async () => {
    const selections: string[] = [];
    const controller = _controller({
      addCustomProvider: () => Promise.resolve("custom-id"),
      providerAdded: (providerId) => selections.push(providerId),
    });
    controller.setOpen(true);

    await controller.choose({ type: "custom" });

    expect(selections).toEqual(["custom-id"]);
    expect(controller.getSnapshot()).toEqual(_closedSnapshot());
  });

  test("close and reopen suppresses stale mutation effects and duplicate submits", async () => {
    const addition = _deferred<void>();
    const additions: string[] = [];
    const selections: string[] = [];
    const controller = _controller({
      addBuiltinProvider: (providerId) => {
        additions.push(providerId);
        return addition.promise;
      },
      providerAdded: (providerId) => selections.push(providerId),
    });
    controller.setOpen(true);
    const pending = controller.choose({
      type: "builtin",
      provider: _provider("alpha"),
    });

    controller.setOpen(false);
    controller.setOpen(true);
    await controller.choose({
      type: "builtin",
      provider: _provider("beta"),
    });
    expect(additions).toEqual(["alpha"]);

    addition.resolve();
    await pending;

    expect(selections).toEqual([]);
    expect(controller.getSnapshot().open).toBe(true);
    expect(controller.getSnapshot().addingProviderId).toBeNull();
  });

  test("reports a current add failure and allows retry", async () => {
    const failures: { name: string; error: unknown }[] = [];
    let additions = 0;
    const controller = _controller({
      addBuiltinProvider: () => {
        additions += 1;
        return additions === 1
          ? Promise.reject(new Error("denied"))
          : Promise.resolve();
      },
      addFailed: (name, error) => failures.push({ name, error }),
    });
    controller.setOpen(true);

    await controller.choose({
      type: "builtin",
      provider: _provider("alpha"),
    });
    expect(failures[0]?.name).toBe("alpha");
    expect(controller.getSnapshot().open).toBe(true);
    expect(controller.getSnapshot().addingProviderId).toBeNull();

    await controller.choose({
      type: "builtin",
      provider: _provider("alpha"),
    });
    expect(additions).toBe(2);
  });
});

function _controller(
  overrides: Partial<AddProviderControllerOptions> = {}
): AddProviderController {
  return new AddProviderController({
    fetchBuiltinProviders: () => Promise.resolve([]),
    addBuiltinProvider: () => Promise.resolve(),
    addCustomProvider: () => Promise.resolve("custom-id"),
    providerAdded: () => undefined,
    addFailed: () => undefined,
    ...overrides,
  });
}

function _provider(id: string): ModelProviderGroup {
  return {
    id,
    name: id,
    models: [],
    profiles: [],
  };
}

function _closedSnapshot() {
  return {
    open: false,
    builtinProviders: null,
    discoveryFailed: false,
    addingProviderId: null,
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
