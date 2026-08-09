import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ProjectWindowManager,
  type ProjectWindowAdapter,
  type ProjectWindowHandle,
} from "./project-window-manager";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("opening an agent project creates its isolated directories and one window", async () => {
  const root = await _project("alpha");
  const opened: string[] = [];
  const manager = new ProjectWindowManager({ windows: _windows(opened) });

  await manager.openProject(root);

  expect(opened).toEqual([root]);
  expect((await stat(join(root, "threads"))).isDirectory()).toBe(true);
  expect(
    (await stat(join(root, ".llm-space", "harness"))).isDirectory()
  ).toBe(true);
});

test("opening the same canonical project activates its existing window", async () => {
  const root = await _project("same");
  const opened: string[] = [];
  let activations = 0;
  const manager = new ProjectWindowManager({
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
  const manager = new ProjectWindowManager({
    windows: {
      async create() {
        creations += 1;
        await createGate;
        return {
          activate: () => {
            activations += 1;
          },
          close: () => undefined,
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
  const manager = new ProjectWindowManager({
    windows: _windows(opened, undefined, (root) => closed.push(root)),
  });

  await manager.openProject(alpha);
  await manager.openProject(beta);
  await manager.closeAll();

  expect(opened).toEqual([alpha, beta]);
  expect(closed).toEqual([alpha, beta]);
});

test("shutdown keeps open project paths available for the next restore", async () => {
  const root = await _project("restore");
  const saved: string[][] = [];
  let notifyClosed: (() => void) | undefined;
  const manager = new ProjectWindowManager({
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
          onClosed: (listener) => {
            notifyClosed = listener;
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
      });
    },
  };
}
