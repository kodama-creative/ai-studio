import { describe, expect, test } from "bun:test";

import type { SkillInfo, SkillsSettings } from "@llm-space/core";

import {
  SkillsSettingsController,
  type SkillsSettingsClient,
} from "./skills-settings-controller";

describe("SkillsSettingsController", () => {
  test("loads settings, selects the first folder, and loads its skills", async () => {
    const controller = _controller({
      client: _client({
        getSettings: () => Promise.resolve(_settings("/alpha", "/beta")),
        list: (path) => Promise.resolve([_skill(path, "one", true)]),
      }),
    });

    controller.start();
    await _eventually(() => controller.getSnapshot().skills?.[0]?.name, "one");

    expect(controller.getSnapshot()).toMatchObject({
      loadingSettings: false,
      selectedPath: "/alpha",
      settings: _settings("/alpha", "/beta"),
      skills: [{ name: "one", enabled: true }],
    });
    controller.stop();
  });

  test("discards a late skill list after the selected folder changes", async () => {
    const alpha = _deferred<SkillInfo[]>();
    const controller = _controller({
      client: _client({
        getSettings: () => Promise.resolve(_settings("/alpha", "/beta")),
        list: (path) =>
          path === "/alpha"
            ? alpha.promise
            : Promise.resolve([_skill(path, "beta-skill", true)]),
      }),
    });

    controller.start();
    await _eventually(() => controller.getSnapshot().selectedPath, "/alpha");
    controller.selectPath("/beta");
    await _eventually(
      () => controller.getSnapshot().skills?.[0]?.name,
      "beta-skill"
    );

    alpha.resolve([_skill("/alpha", "late-alpha", true)]);
    await _flushMicrotasks();
    expect(controller.getSnapshot()).toMatchObject({
      selectedPath: "/beta",
      skills: [{ name: "beta-skill" }],
    });
    controller.stop();
  });

  test("keeps selection and skill lists coherent across folder and bulk mutations", async () => {
    const lists: string[] = [];
    const mutations: string[] = [];
    const controller = _controller({
      browseForPath: () => Promise.resolve("/beta"),
      client: _client({
        getSettings: () => Promise.resolve(_settings("/alpha")),
        addPath: (path) => {
          mutations.push(`add:${path}`);
          return Promise.resolve(_settings("/alpha", "/beta"));
        },
        removePath: (path) => {
          mutations.push(`remove:${path}`);
          return Promise.resolve(_settings("/alpha"));
        },
        setAllHidden: (path, hidden) => {
          mutations.push(`all:${path}:${hidden}`);
          return Promise.resolve(_settings("/alpha", "/beta"));
        },
        list: (path) => {
          lists.push(path);
          const enabled = !(
            path === "/beta" && lists.filter((p) => p === path).length > 1
          );
          return Promise.resolve([_skill(path, `${path}-skill`, enabled)]);
        },
      }),
    });

    controller.start();
    await _eventually(() => controller.getSnapshot().skills?.length, 1);
    await controller.addFolder();
    await _eventually(() => controller.getSnapshot().selectedPath, "/beta");
    expect(controller.getSnapshot().skills?.[0]?.enabled).toBeTrue();

    await controller.setAllEnabled("/beta", false);
    await _eventually(
      () => controller.getSnapshot().skills?.[0]?.enabled,
      false
    );
    await controller.removeFolder("/beta");
    await _eventually(() => controller.getSnapshot().selectedPath, "/alpha");

    expect(mutations).toEqual(["add:/beta", "all:/beta:true", "remove:/beta"]);
    expect(lists).toEqual(["/alpha", "/beta", "/beta", "/alpha"]);
    expect(controller.getSnapshot().skills?.[0]?.name).toBe("/alpha-skill");
    controller.stop();
  });

  test("serializes rapid optimistic toggles and rolls back only the latest intent", async () => {
    const first = _deferred<SkillsSettings>();
    const second = _deferred<SkillsSettings>();
    const calls: boolean[] = [];
    const notifications: string[] = [];
    const controller = _controller({
      notifyError: (title) => notifications.push(title),
      client: _client({
        getSettings: () => Promise.resolve(_settings("/alpha")),
        list: (path) => Promise.resolve([_skill(path, "one", false)]),
        setHidden: ({ hidden }) => {
          calls.push(hidden);
          return calls.length === 1 ? first.promise : second.promise;
        },
      }),
    });

    controller.start();
    await _eventually(
      () => controller.getSnapshot().skills?.[0]?.enabled,
      false
    );
    const enable = controller.setSkillEnabled("one", true);
    const disable = controller.setSkillEnabled("one", false);
    expect(controller.getSnapshot().skills?.[0]?.enabled).toBeFalse();
    await _eventually(() => calls.length, 1);
    expect(calls).toEqual([false]);

    first.reject(new Error("superseded enable failed"));
    await _eventually(() => calls.length, 2);
    expect(controller.getSnapshot().skills?.[0]?.enabled).toBeFalse();
    expect(calls).toEqual([false, true]);
    expect(notifications).toEqual([]);

    second.reject(new Error("latest disable failed"));
    await Promise.all([enable, disable]);
    expect(controller.getSnapshot().skills?.[0]?.enabled).toBeFalse();
    expect(notifications).toEqual(["Failed to update skill"]);
    controller.stop();
  });

  test("ignores late reads and does not run queued mutations after stop", async () => {
    const settings = _deferred<SkillsSettings>();
    const blocker = _deferred<SkillsSettings>();
    let removed = 0;
    const controller = _controller({
      client: _client({
        getSettings: () => settings.promise,
        removePath: (path) => {
          if (path === "/alpha") return blocker.promise;
          removed += 1;
          return Promise.resolve(_settings());
        },
      }),
    });

    controller.start();
    controller.stop();
    settings.resolve(_settings("/late"));
    await _flushMicrotasks();
    expect(controller.getSnapshot().settings).toEqual(_settings());

    const active = _controller({
      client: _client({
        getSettings: () => Promise.resolve(_settings("/alpha", "/beta")),
        list: () => Promise.resolve([]),
        removePath: (path) => {
          if (path === "/alpha") return blocker.promise;
          removed += 1;
          return Promise.resolve(_settings());
        },
      }),
    });
    active.start();
    await _eventually(() => active.getSnapshot().loadingSettings, false);
    const inFlight = active.removeFolder("/alpha");
    const queued = active.removeFolder("/beta");
    await _flushMicrotasks();
    active.stop();
    blocker.resolve(_settings("/beta"));
    await Promise.all([inFlight, queued]);
    expect(removed).toBe(0);
  });
});

function _controller(
  options: {
    client?: SkillsSettingsClient;
    browseForPath?: () => Promise<string | null>;
    notifyError?: (title: string, error: unknown) => void;
  } = {}
): SkillsSettingsController {
  return new SkillsSettingsController(
    options.client ?? _client(),
    { pickDirectory: options.browseForPath ?? (() => Promise.resolve(null)) },
    { reveal: () => Promise.resolve() },
    { error: options.notifyError ?? (() => undefined) }
  );
}

function _client(
  overrides: Partial<SkillsSettingsClient> = {}
): SkillsSettingsClient {
  return {
    getSettings: () => Promise.resolve(_settings()),
    addPath: () => Promise.resolve(_settings()),
    removePath: () => Promise.resolve(_settings()),
    setHidden: () => Promise.resolve(_settings()),
    setAllHidden: () => Promise.resolve(_settings()),
    list: () => Promise.resolve([]),
    ...overrides,
  };
}

function _settings(...paths: string[]): SkillsSettings {
  return {
    discoveryPaths: paths.map((path) => ({ path, hiddenSkills: [] })),
  };
}

function _skill(path: string, name: string, enabled: boolean): SkillInfo {
  return {
    path: `${path}/${name}`,
    name,
    description: `${name} description`,
    enabled,
  };
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

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(read()).toBe(expected);
}

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
