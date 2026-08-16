import { describe, expect, test } from "bun:test";

import type {
  ModelProviderGroup,
  ProviderProfile,
} from "@llm-space/core";

import {
  ModelsSettingsController,
  type ModelsSettingsControllerOptions,
  type ModelsSettingsFailure,
} from "./models-settings-controller";

describe("ModelsSettingsController", () => {
  test("owns provider selection and deterministic catalog fallback", () => {
    const controller = _controller([_provider("zulu"), _provider("alpha")]);

    expect(controller.getSnapshot().selectedProviderId).toBe("alpha");
    controller.selectProvider("zulu");
    expect(controller.getSnapshot().selectedProviderId).toBe("zulu");

    controller.syncCatalog([_provider("bravo"), _provider("alpha")]);
    expect(controller.getSnapshot().selectedProviderId).toBe("alpha");

    controller.syncCatalog([]);
    expect(controller.getSnapshot().selectedProviderId).toBeNull();
    expect(controller.metadata.getSnapshot().providerId).toBe("");
    expect(controller.profiles.getSnapshot().providerId).toBe("");
    expect(controller.profile.getSnapshot().profileId).toBe("");
  });

  test("retargets every child controller with provider and profile selection", () => {
    const alpha = _provider("alpha", [
      _profile("default"),
      _profile("secondary"),
    ]);
    const bravo = _provider("bravo", [_profile("bravo-default")]);
    const controller = _controller([alpha, bravo]);

    expect(controller.metadata.getSnapshot().providerId).toBe("alpha");
    expect(controller.profiles.getSnapshot().selectedProfileId).toBe(
      "default"
    );
    expect(controller.profile.getSnapshot().profileId).toBe("default");

    controller.profiles.select("secondary");
    expect(controller.profile.getSnapshot().profileId).toBe("secondary");

    controller.selectProvider("bravo");
    expect(controller.metadata.getSnapshot().providerId).toBe("bravo");
    expect(controller.profiles.getSnapshot().providerId).toBe("bravo");
    expect(controller.profile.getSnapshot().profileId).toBe("bravo-default");
  });

  test("selects an added provider after its catalog projection arrives", async () => {
    const controller = _controller([_provider("alpha")], {
      addCustomProvider: () => Promise.resolve("custom-id"),
    });
    controller.addProvider.setOpen(true);

    await controller.addProvider.choose({ type: "custom" });
    expect(controller.getSnapshot().selectedProviderId).toBe("alpha");

    controller.syncCatalog([_provider("alpha"), _provider("custom-id")]);
    expect(controller.getSnapshot().selectedProviderId).toBe("custom-id");
  });

  test("admits only one provider removal and falls back after success", async () => {
    const removal = _deferred<void>();
    const calls: string[] = [];
    const controller = _controller(
      [_provider("alpha"), _provider("bravo")],
      {
        removeProvider: (providerId) => {
          calls.push(providerId);
          return removal.promise;
        },
      }
    );
    controller.selectProvider("bravo");
    controller.requestRemoveProvider("bravo");

    const first = controller.confirmRemoveProvider();
    const duplicate = controller.confirmRemoveProvider();
    expect(calls).toEqual(["bravo"]);
    expect(controller.getSnapshot().removingProviderId).toBe("bravo");

    controller.syncCatalog([_provider("alpha")]);
    removal.resolve();
    await Promise.all([first, duplicate]);

    expect(controller.getSnapshot().selectedProviderId).toBe("alpha");
    expect(controller.getSnapshot().removingProviderId).toBeNull();
    expect(controller.getSnapshot().removalCandidateId).toBeNull();
  });

  test("invalidates a removal when its authoritative target disappears", async () => {
    const removal = _deferred<void>();
    const failures: ModelsSettingsFailure[] = [];
    const controller = _controller(
      [_provider("alpha"), _provider("bravo")],
      {
        removeProvider: () => removal.promise,
        mutationFailed: (failure) => failures.push(failure),
      }
    );
    controller.requestRemoveProvider("bravo");
    const obsolete = controller.confirmRemoveProvider();

    controller.syncCatalog([_provider("alpha")]);
    expect(controller.getSnapshot().removingProviderId).toBeNull();
    removal.reject(new Error("obsolete"));
    await obsolete;

    expect(failures).toEqual([]);
    expect(controller.getSnapshot().providers.map(({ id }) => id)).toEqual([
      "alpha",
    ]);
  });

  test("close suppresses obsolete removal results and child mutations", async () => {
    const removal = _deferred<void>();
    const profileSave = _deferred<void>();
    const failures: ModelsSettingsFailure[] = [];
    const controller = _controller([_provider("alpha")], {
      removeProvider: () => removal.promise,
      updateProviderProfile: () => profileSave.promise,
      mutationFailed: (failure) => failures.push(failure),
    });
    controller.requestRemoveProvider("alpha");
    const removing = controller.confirmRemoveProvider();
    controller.profile.draft("name", "Draft");
    controller.profile.commit("name");

    controller.close();
    removal.reject(new Error("obsolete removal"));
    profileSave.reject(new Error("obsolete save"));
    await Promise.all([removing, profileSave.promise.catch(() => undefined)]);
    await Promise.resolve();

    expect(failures).toEqual([]);
    expect(controller.getSnapshot()).toEqual({
      providers: [],
      selectedProviderId: null,
      removalCandidateId: null,
      removingProviderId: null,
    });
    expect(controller.profile.getSnapshot().profileId).toBe("");
  });

  test("reports current provider removal failures and releases admission", async () => {
    const failures: ModelsSettingsFailure[] = [];
    const controller = _controller([_provider("alpha")], {
      removeProvider: () => Promise.reject(new Error("denied")),
      mutationFailed: (failure) => failures.push(failure),
    });
    controller.requestRemoveProvider("alpha");

    await controller.confirmRemoveProvider();

    expect(failures).toEqual([
      { operation: "remove-provider", providerId: "alpha" },
    ]);
    expect(controller.getSnapshot().removingProviderId).toBeNull();
  });
});

function _controller(
  providers: ModelProviderGroup[],
  overrides: Partial<ModelsSettingsControllerOptions> = {}
): ModelsSettingsController {
  return new ModelsSettingsController(providers, {
    fetchBuiltinProviders: () => Promise.resolve([]),
    addBuiltinProvider: () => Promise.resolve(),
    addCustomProvider: () => Promise.resolve("custom-id"),
    removeProvider: () => Promise.resolve(),
    updateProvider: () => Promise.resolve(),
    addProviderProfile: () => Promise.resolve("created-profile"),
    removeProviderProfile: () => Promise.resolve(),
    updateProviderProfile: () => Promise.resolve(),
    mutationFailed: () => undefined,
    ...overrides,
  });
}

function _provider(
  id: string,
  profiles: ProviderProfile[] = [_profile(`${id}-default`)]
): ModelProviderGroup {
  return {
    id,
    name: id,
    models: [],
    profiles,
  };
}

function _profile(id: string): ProviderProfile {
  return { id, name: id };
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
