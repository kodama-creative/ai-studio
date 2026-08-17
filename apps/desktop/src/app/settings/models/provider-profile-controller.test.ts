import { describe, expect, test } from "bun:test";

import type { ProviderProfilePatch } from "@llm-space/core";

import {
  ProviderProfileController,
  type ProviderProfileTarget,
} from "./provider-profile-controller";

interface TestOptions {
  readonly updateProfile: (
    providerId: string,
    profileId: string,
    patch: ProviderProfilePatch
  ) => Promise<void>;
  readonly saveFailed: (title: string, error: unknown) => void;
}

describe("ProviderProfileController", () => {
  test("rolls a failed latest scalar intent back to the last successful value", async () => {
    const first = _deferred<void>();
    const second = _deferred<void>();
    let writes = 0;
    const failures: string[] = [];
    const controller = _controller({
      updateProfile: () => {
        writes += 1;
        return writes === 1 ? first.promise : second.promise;
      },
      saveFailed: (field) => failures.push(field),
    });

    controller.draft("apiKey", "first-key");
    controller.commit("apiKey");
    controller.draft("apiKey", "second-key");
    controller.commit("apiKey");
    first.resolve();
    await first.promise;
    await Promise.resolve();
    second.reject(new Error("second failed"));
    await _eventually(() => controller.getSnapshot().apiKey, "first-key");

    expect(failures).toEqual(["Failed to update provider profile"]);
  });

  test("rolls two failed scalar intents back to the catalog projection", async () => {
    const first = _deferred<void>();
    const second = _deferred<void>();
    let writes = 0;
    const controller = _controller({
      updateProfile: () => {
        writes += 1;
        return writes === 1 ? first.promise : second.promise;
      },
    });

    controller.draft("baseUrl", "https://first.example/v1");
    controller.commit("baseUrl");
    controller.draft("baseUrl", "https://second.example/v1");
    controller.commit("baseUrl");
    first.reject(new Error("first failed"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    second.reject(new Error("second failed"));
    await _eventually(
      () => controller.getSnapshot().baseUrl,
      "https://initial.example/v1"
    );
  });

  test("normalizes scalar Drafts and rejects an empty profile name locally", async () => {
    const patches: ProviderProfilePatch[] = [];
    const controller = _controller({
      updateProfile: (_providerId, _profileId, patch) => {
        patches.push(patch);
        return Promise.resolve();
      },
    });

    controller.draft("name", "   ");
    controller.commit("name");
    controller.draft("apiKey", "  secret  ");
    controller.commit("apiKey");
    await _eventually(() => patches.length, 1);

    expect(controller.getSnapshot().name).toBe("Default");
    expect(patches).toEqual([{ apiKey: "secret" }]);
  });

  test("keeps a newer scalar Draft when an older save fails", async () => {
    const save = _deferred<void>();
    const controller = _controller({ updateProfile: () => save.promise });
    controller.draft("name", "First");
    controller.commit("name");
    controller.draft("name", "Still typing");

    save.reject(new Error("failed"));
    await save.promise.catch(() => undefined);
    await Promise.resolve();

    expect(controller.getSnapshot().name).toBe("Still typing");
  });

  test("restores a failed custom-base-URL clear without overriding a re-enable", async () => {
    const first = _deferred<void>();
    const controller = _controller({ updateProfile: () => first.promise });

    controller.setBaseUrlEnabled(false);
    expect(controller.getSnapshot().baseUrlEnabled).toBe(false);
    controller.setBaseUrlEnabled(true);
    first.reject(new Error("clear failed"));
    await first.promise.catch(() => undefined);
    await _eventually(
      () => controller.getSnapshot().baseUrl,
      "https://initial.example/v1"
    );

    expect(controller.getSnapshot().baseUrlEnabled).toBe(true);
    expect(controller.getSnapshot().baseUrl).toBe("https://initial.example/v1");
  });

  test("retains a failed latest header Draft and makes it retryable", async () => {
    const first = _deferred<void>();
    const second = _deferred<void>();
    const patches: ProviderProfilePatch[] = [];
    const failures: string[] = [];
    const controller = _controller({
      updateProfile: (_providerId, _profileId, patch) => {
        patches.push(patch);
        return patches.length === 1
          ? first.promise
          : patches.length === 2
            ? second.promise
            : Promise.resolve();
      },
      saveFailed: (field) => failures.push(field),
    });
    const rowId = controller.getSnapshot().headers[0]?.id;
    expect(rowId).toBeString();

    controller.editHeader(rowId, "value", "two");
    controller.commitHeaders();
    controller.editHeader(rowId, "value", "three");
    controller.commitHeaders();
    first.resolve();
    await first.promise;
    await Promise.resolve();
    second.reject(new Error("latest failed"));
    await _eventually(() => failures.length, 1);

    expect(controller.getSnapshot().headers[0]?.value).toBe("three");
    expect(failures).toEqual(["Failed to update provider profile"]);

    controller.commitHeaders();
    await _eventually(() => patches.length, 3);
    expect(patches[2]).toEqual({ headers: { "X-Test": "three" } });
  });

  test("removing the last named header persists null and row identities stay stable", async () => {
    const patches: ProviderProfilePatch[] = [];
    const controller = _controller({
      updateProfile: (_providerId, _profileId, patch) => {
        patches.push(patch);
        return Promise.resolve();
      },
    });
    const originalId = controller.getSnapshot().headers[0]?.id;

    controller.addHeader();
    const addedId = controller.getSnapshot().headers[1]?.id;
    expect(addedId).not.toBe(originalId);
    controller.removeHeader(originalId);
    await _eventually(() => patches.length, 1);

    expect(controller.getSnapshot().headers.map((row) => row.id)).toEqual([
      addedId,
    ]);
    expect(patches).toEqual([{ headers: null }]);
  });

  test("catalog sync updates idle fields while preserving live Drafts", () => {
    const controller = _controller();
    controller.draft("apiKey", "draft-key");
    const target = _target("provider", "profile");
    target.profile.name = "Remote name";
    target.profile.apiKey = "remote-key";
    target.profile.baseUrl = "https://remote.example/v1";

    controller.sync(target);

    expect(controller.getSnapshot().name).toBe("Remote name");
    expect(controller.getSnapshot().apiKey).toBe("draft-key");
    expect(controller.getSnapshot().baseUrl).toBe("https://remote.example/v1");
  });

  test("retargeting skips queued work and ignores the old in-flight failure", async () => {
    const oldSave = _deferred<void>();
    const writes: string[] = [];
    const failures: string[] = [];
    const controller = _controller({
      updateProfile: (_providerId, profileId) => {
        writes.push(profileId);
        return profileId === "profile" ? oldSave.promise : Promise.resolve();
      },
      saveFailed: (field) => failures.push(field),
    });
    controller.draft("apiKey", "old-key");
    controller.commit("apiKey");
    await _eventually(() => writes.includes("profile"), true);
    controller.draft("name", "queued old name");
    controller.commit("name");

    controller.sync(_target("replacement-provider", "replacement-profile"));
    controller.draft("apiKey", "replacement-key");
    controller.commit("apiKey");
    oldSave.reject(new Error("obsolete"));
    await oldSave.promise.catch(() => undefined);
    await _eventually(() => writes.includes("replacement-profile"), true);

    expect(writes).toEqual(["profile", "replacement-profile"]);
    expect(failures).toEqual([]);
    expect(controller.getSnapshot().profileId).toBe("replacement-profile");
  });
});

function _controller(
  overrides: Partial<TestOptions> = {}
): ProviderProfileController {
  const options: TestOptions = {
    updateProfile: () => Promise.resolve(),
    saveFailed: () => undefined,
    ...overrides,
  };
  const controller = new ProviderProfileController(
    { updateProviderProfile: options.updateProfile },
    {
      error: options.saveFailed,
    }
  );
  controller.sync(_target("provider", "profile"));
  return controller;
}

function _target(providerId: string, profileId: string): ProviderProfileTarget {
  return {
    providerId,
    profile: {
      id: profileId,
      name: "Default",
      apiKey: "initial-key",
      baseUrl: "https://initial.example/v1",
      headers: { "X-Test": "one" },
    },
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
    if (Object.is(read(), expected)) return;
    await Promise.resolve();
  }
  expect(read()).toEqual(expected);
}
