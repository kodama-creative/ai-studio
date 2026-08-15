import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RemindersState } from "./state";

let testHome = "";
let statePath = "";
let states: RemindersState[] = [];

beforeEach(async () => {
  testHome = await mkdtemp(path.join(os.tmpdir(), "llm-space-reminders-"));
  statePath = path.join(testHome, "settings", "reminders.json");
  states = [];
});

afterEach(async () => {
  await Promise.all(states.map((state) => state.dispose()));
  await rm(testHome, { recursive: true, force: true });
});

function _state(launchId: string): RemindersState {
  const state = new RemindersState(statePath, { launchId });
  states.push(state);
  return state;
}

async function _readGithubStarState(): Promise<Record<string, unknown>> {
  const content = await readFile(
    statePath,
    "utf8"
  );
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || !("githubStar" in parsed)) {
    throw new Error("GitHub star reminder state was not persisted.");
  }
  const githubStar = parsed.githubStar;
  if (!githubStar || typeof githubStar !== "object") {
    throw new Error("GitHub star reminder state is invalid.");
  }
  return githubStar as Record<string, unknown>;
}

describe("resolveGithubStarReminder", () => {
  test("counts repeated renderer requests only once per app launch", async () => {
    const state = _state("first-launch");
    expect(await state.shouldShowGithubStar()).toEqual({
      show: false,
    });
    expect(await state.shouldShowGithubStar()).toEqual({
      show: false,
    });

    expect(await _readGithubStarState()).toMatchObject({
      openCount: 1,
      lastResolvedLaunchId: "first-launch",
      lastResolvedShow: false,
    });
  });

  test("first shows on a distinct second app launch and stays idempotent", async () => {
    expect(await _state("first-launch").shouldShowGithubStar()).toEqual({
      show: false,
    });
    const secondLaunch = _state("second-launch");
    expect(await secondLaunch.shouldShowGithubStar()).toEqual({
      show: true,
    });
    expect(await secondLaunch.shouldShowGithubStar()).toEqual({
      show: true,
    });

    expect(await _readGithubStarState()).toMatchObject({
      openCount: 2,
      shownCount: 1,
      lastResolvedLaunchId: "second-launch",
      lastResolvedShow: true,
    });
  });
});
