import { expect, test } from "bun:test";

import { DeepLinkInbox } from "../deep-link/deep-link-inbox";

import {
  DesktopLaunchService,
  type DesktopLaunchTargets,
} from "./desktop-launch-service";

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
  const service = new DesktopLaunchService(inbox, SCHEME, targets, {
    report: (error, url) => errors.push({ error, url }),
  });
  return { errors, inbox, main, projects, service, targets };
}

test("DesktopLaunchService opens Main for an ordinary cold launch", async () => {
  const { main, projects, service } = _fixture();

  await service.start();

  expect(main).toEqual([undefined]);
  expect(projects).toEqual([]);
});

test("DesktopLaunchService keeps a Studio-only launch free of Main", async () => {
  const { inbox, main, projects, service } = _fixture();
  inbox.accept("llm-space-dev://studio/open?project=/tmp/studio-only");

  await service.start();

  expect(main).toEqual([]);
  expect(projects).toEqual(["/tmp/studio-only"]);
});

test("DesktopLaunchService routes buffered Studio and Main links once", async () => {
  const { inbox, main, projects, service } = _fixture();
  inbox.accept("llm-space-dev://studio/open?project=%2Ftmp%2Fagent-project");
  inbox.accept("llm-space-dev://shared/gist/threads/abc");

  await service.start();

  expect(projects).toEqual(["/tmp/agent-project"]);
  expect(main).toEqual(["llm-space-dev://shared/gist/threads/abc"]);
});

test("DesktopLaunchService routes live links and disconnects on dispose", async () => {
  const { inbox, main, projects, service } = _fixture();
  await service.start();

  inbox.accept("llm-space-dev://studio/open?project=/tmp/live");
  expect(projects).toEqual(["/tmp/live"]);
  await service.dispose();
  inbox.accept("llm-space-dev://shared/gist/threads/later");
  service.reopen();

  expect(main).toEqual([undefined]);
  expect(inbox.connect(() => undefined).bufferedUrls).toEqual([
    "llm-space-dev://shared/gist/threads/later",
  ]);
});

test("DesktopLaunchService contains link and reopen failures", async () => {
  const { errors, inbox, main, service, targets } = _fixture();
  inbox.accept("llm-space-dev://studio/open");

  await service.start();
  expect(main).toEqual([undefined]);
  targets.openMain = () => Promise.reject(new Error("reopen failed"));
  service.reopen();
  await Promise.resolve();
  await Promise.resolve();

  expect(errors.map(({ error }) => error.message)).toEqual([
    "Can't open Studio: the project path is missing.",
    "reopen failed",
  ]);
  expect(errors[0]?.url).toBe("llm-space-dev://studio/open");
  expect(service.start()).rejects.toThrow(
    "Desktop launch service is already started."
  );
});

test("DesktopLaunchService falls back to Main when every cold target fails", async () => {
  const { errors, inbox, main, service, targets } = _fixture();
  inbox.accept("llm-space-dev://studio/open?project=/tmp/unavailable");
  targets.openProject = () => Promise.reject(new Error("project failed"));

  await service.start();

  expect(main).toEqual([undefined]);
  expect(errors.map(({ error }) => error.message)).toEqual(["project failed"]);
});
