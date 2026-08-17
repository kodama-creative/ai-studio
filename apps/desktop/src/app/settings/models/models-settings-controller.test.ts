import { describe, expect, test } from "bun:test";

import type {
  ModelProviderGroup,
  ProviderProfile,
  ProviderProfilePatch,
} from "@llm-space/core";

import { AddProviderController } from "./add-provider-controller";
import { ModelsSettingsController } from "./models-settings-controller";
import { ProviderMetadataController } from "./provider-metadata-controller";
import { ProviderProfileController } from "./provider-profile-controller";
import { ProviderProfilesController } from "./provider-profiles-controller";

interface TestOptions {
  readonly catalog?: {
    readonly read: () => readonly ModelProviderGroup[];
    readonly subscribe: (listener: () => void) => () => void;
  };
  readonly fetchBuiltinProviders: () => Promise<ModelProviderGroup[]>;
  readonly addBuiltinProvider: (providerId: string) => Promise<void>;
  readonly addCustomProvider: () => Promise<string>;
  readonly removeProvider: (providerId: string) => Promise<void>;
  readonly updateProvider: (
    providerId: string,
    patch: Parameters<
      ConstructorParameters<
        typeof ProviderMetadataController
      >[0]["updateProvider"]
    >[1]
  ) => Promise<void>;
  readonly addProviderProfile: (providerId: string) => Promise<string>;
  readonly removeProviderProfile: (
    providerId: string,
    profileId: string
  ) => Promise<void>;
  readonly updateProviderProfile: (
    providerId: string,
    profileId: string,
    patch: ProviderProfilePatch
  ) => Promise<void>;
  readonly mutationFailed: (title: string, error: unknown) => void;
}

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
    expect(controller.getSnapshot().metadata.providerId).toBe("");
    expect(controller.getSnapshot().profiles.providerId).toBe("");
    expect(controller.getSnapshot().profile.profileId).toBe("");
  });

  test("retargets every child controller with provider and profile selection", () => {
    const alpha = _provider("alpha", [
      _profile("default"),
      _profile("secondary"),
    ]);
    const bravo = _provider("bravo", [_profile("bravo-default")]);
    const controller = _controller([alpha, bravo]);

    expect(controller.getSnapshot().metadata.providerId).toBe("alpha");
    expect(controller.getSnapshot().profiles.selectedProfileId).toBe("default");
    expect(controller.getSnapshot().profile.profileId).toBe("default");

    controller.intents.profiles.select("secondary");
    expect(controller.getSnapshot().profile.profileId).toBe("secondary");

    controller.selectProvider("bravo");
    expect(controller.getSnapshot().metadata.providerId).toBe("bravo");
    expect(controller.getSnapshot().profiles.providerId).toBe("bravo");
    expect(controller.getSnapshot().profile.profileId).toBe("bravo-default");
  });

  test("selects an added provider after its catalog projection arrives", async () => {
    const controller = _controller([_provider("alpha")], {
      addCustomProvider: () => Promise.resolve("custom-id"),
    });
    controller.intents.addProvider.setOpen(true);

    await controller.intents.addProvider.choose({ type: "custom" });
    expect(controller.getSnapshot().selectedProviderId).toBe("alpha");

    controller.syncCatalog([_provider("alpha"), _provider("custom-id")]);
    expect(controller.getSnapshot().selectedProviderId).toBe("custom-id");
  });

  test("admits only one provider removal and falls back after success", async () => {
    const removal = _deferred<void>();
    const calls: string[] = [];
    const controller = _controller([_provider("alpha"), _provider("bravo")], {
      removeProvider: (providerId) => {
        calls.push(providerId);
        return removal.promise;
      },
    });
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
    const failures: string[] = [];
    const controller = _controller([_provider("alpha"), _provider("bravo")], {
      removeProvider: () => removal.promise,
      mutationFailed: (failure) => failures.push(failure),
    });
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
    const failures: string[] = [];
    const controller = _controller([_provider("alpha")], {
      removeProvider: () => removal.promise,
      updateProviderProfile: () => profileSave.promise,
      mutationFailed: (failure) => failures.push(failure),
    });
    controller.requestRemoveProvider("alpha");
    const removing = controller.confirmRemoveProvider();
    controller.intents.profile.draft("name", "Draft");
    controller.intents.profile.commit("name");

    controller.stop();
    removal.reject(new Error("obsolete removal"));
    profileSave.reject(new Error("obsolete save"));
    await Promise.all([removing, profileSave.promise.catch(() => undefined)]);
    await Promise.resolve();

    expect(failures).toEqual([]);
    const stopped = controller.getSnapshot();
    expect({
      providers: stopped.providers,
      selectedProviderId: stopped.selectedProviderId,
      removalCandidateId: stopped.removalCandidateId,
      removingProviderId: stopped.removingProviderId,
    }).toEqual({
      providers: [_provider("alpha")],
      selectedProviderId: "alpha",
      removalCandidateId: null,
      removingProviderId: null,
    });
    expect(controller.getSnapshot().profile.profileId).toBe("");
  });

  test("reports current provider removal failures and releases admission", async () => {
    const failures: string[] = [];
    const controller = _controller([_provider("alpha")], {
      removeProvider: () => Promise.reject(new Error("denied")),
      mutationFailed: (failure) => failures.push(failure),
    });
    controller.requestRemoveProvider("alpha");

    await controller.confirmRemoveProvider();

    expect(failures).toEqual(["Failed to remove provider"]);
    expect(controller.getSnapshot().removingProviderId).toBeNull();
  });
});

function _controller(
  providers: ModelProviderGroup[],
  overrides: Partial<TestOptions> = {}
): ModelsSettingsController {
  const options: TestOptions = {
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
  };
  const catalog = {
    getSnapshot: () => ({
      providers: options.catalog?.read() ?? providers,
    }),
    subscribe: (listener: () => void) =>
      options.catalog?.subscribe(listener) ?? (() => undefined),
    builtinProviders: options.fetchBuiltinProviders,
    addProvider: options.addBuiltinProvider,
    addCustomProvider: async () => options.addCustomProvider(),
    removeProvider: options.removeProvider,
    updateProvider: options.updateProvider,
    addProviderProfile: options.addProviderProfile,
    removeProviderProfile: options.removeProviderProfile,
    updateProviderProfile: options.updateProviderProfile,
  };
  const notifications = {
    error: options.mutationFailed,
  };
  const controller = new ModelsSettingsController(
    catalog,
    notifications,
    new AddProviderController(catalog, notifications),
    new ProviderMetadataController(catalog, notifications),
    new ProviderProfilesController(catalog, notifications),
    new ProviderProfileController(catalog, notifications)
  );
  controller.start();
  return controller;
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
