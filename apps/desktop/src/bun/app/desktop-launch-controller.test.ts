import { expect, test } from "bun:test";

import { DeepLinkInbox } from "../deep-link/deep-link-inbox";

import {
  DesktopLaunchController,
  type DesktopLaunchTargets,
} from "./desktop-launch-controller";

const SCHEME = "llm-space-dev" as const;

function _fixture() {
  const inbox = new DeepLinkInbox();
  const main: (string | undefined)[] = [];
  const projects: string[] = [];
  const errors: { error: Error; url?: string }[] = [];
  const targets: DesktopLaunchTargets = {
    openMain: (url) => {
      main.push(url);
      return Promise.resolve();
    },
    openProject: (rootPath) => {
      projects.push(rootPath);
      return Promise.resolve();
    },
  };
  const controller = new DesktopLaunchController({
    deepLinks: inbox,
    scheme: SCHEME,
    targets,
    onOpenError: (error, url) => errors.push({ error, url }),
  });
  return { controller, errors, inbox, main, projects, targets };
}

test("DesktopLaunchController opens Main for an ordinary cold launch", async () => {
  const { controller, main, projects } = _fixture();

  await controller.start();

  expect(main).toEqual([undefined]);
  expect(projects).toEqual([]);
});

test("DesktopLaunchController keeps a Studio-only launch free of Main", async () => {
  const { controller, inbox, main, projects } = _fixture();
  inbox.accept("llm-space-dev://studio/open?project=/tmp/studio-only");

  await controller.start();

  expect(main).toEqual([]);
  expect(projects).toEqual(["/tmp/studio-only"]);
});

test("DesktopLaunchController routes buffered Studio and Main links once", async () => {
  const { controller, inbox, main, projects } = _fixture();
  inbox.accept(
    "llm-space-dev://studio/open?project=%2Ftmp%2Fagent-project"
  );
  inbox.accept("llm-space-dev://shared/gist/threads/abc");

  await controller.start();

  expect(projects).toEqual(["/tmp/agent-project"]);
  expect(main).toEqual(["llm-space-dev://shared/gist/threads/abc"]);
});

test("DesktopLaunchController routes live links and disconnects on dispose", async () => {
  const { controller, inbox, main, projects } = _fixture();
  await controller.start();

  inbox.accept("llm-space-dev://studio/open?project=/tmp/live");
  expect(projects).toEqual(["/tmp/live"]);
  void controller.dispose();
  inbox.accept("llm-space-dev://shared/gist/threads/later");
  controller.reopen();

  expect(main).toEqual([undefined]);
  expect(inbox.connect(() => undefined).bufferedUrls).toEqual([
    "llm-space-dev://shared/gist/threads/later",
  ]);
});

test("DesktopLaunchController contains link and reopen failures", async () => {
  const { controller, errors, inbox, targets } = _fixture();
  inbox.accept("llm-space-dev://studio/open");
  targets.openMain = () => Promise.reject(new Error("reopen failed"));

  await controller.start();
  controller.reopen();
  await Promise.resolve();
  await Promise.resolve();

  expect(errors.map(({ error }) => error.message)).toEqual([
    "Can't open Studio: the project path is missing.",
    "reopen failed",
  ]);
  expect(errors[0]?.url).toBe("llm-space-dev://studio/open");
  expect(controller.start()).rejects.toThrow(
    "Desktop launch controller is already started."
  );
});
