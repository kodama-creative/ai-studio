import { afterEach, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentProject } from "./agent-project";
import {
  type AgentProjectCatalogStore,
  type ProjectWindowStateStore,
  ProjectWindowManager,
  type ProjectWindowAdapter,
  type ProjectWindowHandle,
} from "./project-window-manager";

interface TestOptions {
  readonly windows: ProjectWindowAdapter;
  readonly state?: ProjectWindowStateStore;
  readonly catalog?: AgentProjectCatalogStore;
  readonly openProject?: typeof openAgentProject;
}

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("opening an agent project creates its Studio state directory and one window", async () => {
  const root = await _project("alpha");
  const homePath = await mkdtemp(join(tmpdir(), "llm-space-agent-home-"));
  ROOTS.push(homePath);
  const opened: string[] = [];
  const manager = _manager({
    windows: _windows(opened),
    openProject: (path) =>
      import("./agent-project").then(({ openAgentProject }) =>
        openAgentProject(path, { homePath })
      ),
  });

  await manager.openProject(root);

  expect(opened).toEqual([root]);
  const studioProjects = join(homePath, "studio", "projects");
  expect((await stat(studioProjects)).isDirectory()).toBe(true);
  expect(access(join(root, ".llm-space"))).rejects.toThrow();
});

test("opening the same canonical project activates its existing window", async () => {
  const root = await _project("same");
  const opened: string[] = [];
  let activations = 0;
  const manager = _manager({
    windows: _windows(opened, () => {
      activations += 1;
    }),
  });

  await manager.openProject(root);
  await manager.openProject(join(root, "agent"));

  expect(opened).toEqual([root]);
  expect(activations).toBe(1);
});

test("concurrent opens of one canonical project share the in-flight window", async () => {
  const root = await _project("concurrent");
  let creations = 0;
  let activations = 0;
  let finishCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    finishCreate = resolve;
  });
  const manager = _manager({
    windows: {
      async create() {
        creations += 1;
        await createGate;
        return {
          activate: () => {
            activations += 1;
          },
          close: () => undefined,
          onDidClose: _emptyEvent,
        };
      },
    },
  });

  const first = manager.openProject(root);
  const second = manager.openProject(join(root, "agent"));
  await Bun.sleep(0);
  finishCreate();
  await Promise.all([first, second]);

  expect(creations).toBe(1);
  expect(activations).toBe(1);
});

test("different projects remain isolated and close together", async () => {
  const alpha = await _project("alpha");
  const beta = await _project("beta");
  const opened: string[] = [];
  const closed: string[] = [];
  const manager = _manager({
    windows: _windows(opened, undefined, (root) => closed.push(root)),
  });

  await manager.openProject(alpha);
  await manager.openProject(beta);
  await manager.closeAll();

  expect(opened).toEqual([alpha, beta]);
  expect(closed).toEqual([alpha, beta]);
});

test("concurrent project opens serialize durable catalog mutations", async () => {
  const alpha = await _project("alpha-catalog");
  const beta = await _project("beta-catalog");
  let paths: readonly string[] = [];
  let saves = 0;
  const manager = _manager({
    catalog: {
      load: async () => {
        await Bun.sleep(1);
        return paths;
      },
      save: (next) => {
        saves += 1;
        paths = [...next];
        return Promise.resolve();
      },
    },
    windows: _windows([]),
  });

  await Promise.all([manager.openProject(alpha), manager.openProject(beta)]);

  expect(new Set(paths)).toEqual(new Set([alpha, beta]));
  expect(saves).toBe(2);
});

test("opened projects remain in the main-window catalog after their windows close", async () => {
  const root = await _project("catalog");
  let paths: readonly string[] = [];
  let notifyClosed: (() => void) | undefined;
  const manager = _manager({
    catalog: {
      load: () => Promise.resolve(paths),
      save: (next) => {
        paths = [...next];
        return Promise.resolve();
      },
    },
    windows: {
      create: () =>
        Promise.resolve({
          activate: () => undefined,
          close: () => notifyClosed?.(),
          onDidClose: (listener) => {
            notifyClosed = listener;
            return { dispose: () => undefined };
          },
        }),
    },
  });
  let catalogChanges = 0;
  manager.onDidChange(() => {
    catalogChanges += 1;
  });

  await manager.openProject(root);
  await manager.openProject(root);
  await manager.closeAll();

  expect(paths).toEqual([root]);
  expect(catalogChanges).toBe(1);
  expect(
    (await manager.listProjects()).map((project) => project.rootPath)
  ).toEqual([root]);
});

test("shutdown keeps open project paths available for the next restore", async () => {
  const root = await _project("restore");
  const saved: string[][] = [];
  let notifyClosed: (() => void) | undefined;
  const manager = _manager({
    state: {
      load: () => Promise.resolve([]),
      save: (paths) => {
        saved.push([...paths]);
        return Promise.resolve();
      },
    },
    windows: {
      create: () =>
        Promise.resolve({
          activate: () => undefined,
          close: () => notifyClosed?.(),
          onDidClose: (listener) => {
            notifyClosed = listener;
            return { dispose: () => undefined };
          },
        }),
    },
  });

  await manager.openProject(root);
  await manager.closeAll();

  expect(saved).toEqual([[root]]);
});

async function _project(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "llm-space-agent-project-"));
  ROOTS.push(parent);
  const root = join(parent, name);
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: `example-${name}`, private: true })}\n`
  );
  return realpath(root);
}

function _manager(options: TestOptions): ProjectWindowManager {
  return new ProjectWindowManager(
    options.windows,
    options.state ?? {
      load: () => Promise.resolve([]),
      save: () => Promise.resolve(),
    },
    options.catalog ?? {
      load: () => Promise.resolve([]),
      save: () => Promise.resolve(),
    },
    { open: options.openProject ?? openAgentProject }
  );
}

function _windows(
  opened: string[],
  activate: (() => void) | undefined = undefined,
  close: ((root: string) => void) | undefined = undefined
): ProjectWindowAdapter {
  return {
    create(project): Promise<ProjectWindowHandle> {
      opened.push(project.rootPath);
      return Promise.resolve({
        activate: activate ?? (() => undefined),
        close: () => close?.(project.rootPath),
        onDidClose: _emptyEvent,
      });
    },
  };
}

function _emptyEvent(): { dispose(): void } {
  return { dispose: () => undefined };
}
