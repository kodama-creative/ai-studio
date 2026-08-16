import { describe, expect, test } from "bun:test";

import {
  ProviderProfilesController,
  type ProviderProfilesControllerOptions,
  type ProviderProfilesTarget,
} from "./provider-profiles-controller";

describe("ProviderProfilesController", () => {
  test("admits only one add and selects the created profile", async () => {
    const added = _deferred<string>();
    let calls = 0;
    const controller = _controller({
      addProfile: () => {
        calls += 1;
        return added.promise;
      },
    });

    const first = controller.add();
    const duplicate = controller.add();
    expect(controller.getSnapshot().mutation).toBe("adding");
    expect(calls).toBe(1);

    added.resolve("created");
    await Promise.all([first, duplicate]);

    expect(controller.getSnapshot().selectedProfileId).toBe("created");
    expect(controller.getSnapshot().mutation).toBeNull();
  });

  test("uses one lock across add and remove operations", async () => {
    const added = _deferred<string>();
    const removals: string[] = [];
    const controller = _controller({
      addProfile: () => added.promise,
      removeProfile: (_providerId, profileId) => {
        removals.push(profileId);
        return Promise.resolve();
      },
    });
    controller.requestRemove("secondary");

    const adding = controller.add();
    await controller.confirmRemove();
    expect(removals).toEqual([]);

    added.resolve("created");
    await adding;
  });

  test("falls back from a removed selection and protects the first profile", async () => {
    const removals: string[] = [];
    const controller = _controller({
      removeProfile: (_providerId, profileId) => {
        removals.push(profileId);
        return Promise.resolve();
      },
    });

    controller.select("secondary");
    controller.requestRemove("secondary");
    await controller.confirmRemove();

    expect(removals).toEqual(["secondary"]);
    expect(controller.getSnapshot().selectedProfileId).toBe("default");

    controller.requestRemove("default");
    await controller.confirmRemove();
    expect(removals).toEqual(["secondary"]);
  });

  test("catalog sync preserves a valid selection and repairs stale targets", () => {
    const controller = _controller();
    controller.select("secondary");
    controller.requestRemove("secondary");

    controller.sync({
      providerId: "provider",
      profiles: [{ id: "default", name: "Default" }],
    });

    expect(controller.getSnapshot()).toEqual({
      mutation: null,
      providerId: "provider",
      removalCandidateId: null,
      selectedProfileId: "default",
    });
  });

  test("retargeting suppresses an old add result and failure", async () => {
    const oldAdd = _deferred<string>();
    const failures: string[] = [];
    const controller = _controller({
      addProfile: (providerId) =>
        providerId === "provider"
          ? oldAdd.promise
          : Promise.resolve("replacement-created"),
      mutationFailed: (operation) => failures.push(operation),
    });

    const obsolete = controller.add();
    controller.sync(_target("replacement"));
    const current = controller.add();
    oldAdd.reject(new Error("obsolete"));
    await Promise.all([obsolete, current]);

    expect(failures).toEqual([]);
    expect(controller.getSnapshot().providerId).toBe("replacement");
    expect(controller.getSnapshot().selectedProfileId).toBe(
      "replacement-created"
    );
  });

  test("reports current failures and releases the mutation lock", async () => {
    const failures: string[] = [];
    const controller = _controller({
      addProfile: () => Promise.reject(new Error("failed")),
      mutationFailed: (operation) => failures.push(operation),
    });

    await controller.add();

    expect(failures).toEqual(["add"]);
    expect(controller.getSnapshot().mutation).toBeNull();
  });
});

function _controller(
  overrides: Partial<ProviderProfilesControllerOptions> = {}
): ProviderProfilesController {
  return new ProviderProfilesController(_target("provider"), {
    addProfile: () => Promise.resolve("created"),
    removeProfile: () => Promise.resolve(),
    mutationFailed: () => undefined,
    ...overrides,
  });
}

function _target(providerId: string): ProviderProfilesTarget {
  return {
    providerId,
    profiles: [
      { id: "default", name: "Default" },
      { id: "secondary", name: "Secondary" },
    ],
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
