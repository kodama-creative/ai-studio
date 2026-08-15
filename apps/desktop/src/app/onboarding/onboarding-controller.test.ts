import { describe, expect, test } from "bun:test";

import type { ModelProviderGroup } from "@llm-space/core";

import {
  OnboardingController,
  type OnboardingControllerOptions,
} from "./onboarding-controller";

describe("OnboardingController", () => {
  test("ignores provider discovery completed after close", async () => {
    const discovery = _deferred<ModelProviderGroup[]>();
    const controller = _controller({
      fetchBuiltinProviders: () => discovery.promise,
    });

    controller.open(true);
    controller.close();
    discovery.resolve([_provider("late")]);
    await discovery.promise;
    await Promise.resolve();

    expect(controller.getSnapshot()).toEqual({
      builtinProviders: null,
      providerDiscoveryFailed: false,
      addingProviderId: null,
      addedProviderName: null,
    });
  });

  test("a newer discovery state supersedes an older request", async () => {
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

    controller.open(true);
    controller.open(false);
    controller.open(true);
    await _eventually(
      () => controller.getSnapshot().builtinProviders?.[0]?.id,
      "latest"
    );
    first.resolve([_provider("stale")]);
    await Promise.resolve();

    expect(controller.getSnapshot().builtinProviders?.[0]?.id).toBe("latest");
  });

  test("serializes provider additions and resets the next open session", async () => {
    const addition = _deferred<void>();
    const addedIds: string[] = [];
    const notifications: string[] = [];
    const controller = _controller({
      addProvider: (providerId) => {
        addedIds.push(providerId);
        return addition.promise;
      },
      notifyProviderAdded: (name) => notifications.push(name),
    });
    controller.open(false);

    const first = controller.addProvider(_provider("alpha"));
    await controller.addProvider(_provider("beta"));
    expect(addedIds).toEqual(["alpha"]);
    expect(controller.getSnapshot().addingProviderId).toBe("alpha");

    addition.resolve();
    await first;
    expect(controller.getSnapshot().addedProviderName).toBe("alpha");
    expect(notifications).toEqual(["alpha"]);

    controller.close();
    controller.open(false);
    expect(controller.getSnapshot().addedProviderName).toBeNull();
  });

  test("contains add failures only while the session is current", async () => {
    const addition = _deferred<void>();
    let failures = 0;
    const controller = _controller({
      addProvider: () => addition.promise,
      notifyAddFailed: () => {
        failures += 1;
      },
    });
    controller.open(false);

    const pending = controller.addProvider(_provider("alpha"));
    controller.close();
    addition.reject(new Error("failed"));
    await pending;

    expect(failures).toBe(0);
    expect(controller.getSnapshot().addingProviderId).toBeNull();
  });
});

function _controller(
  overrides: Partial<OnboardingControllerOptions> = {}
): OnboardingController {
  return new OnboardingController({
    fetchBuiltinProviders: () => Promise.resolve([]),
    addProvider: () => Promise.resolve(),
    notifyProviderAdded: () => undefined,
    notifyAddFailed: () => undefined,
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
