import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_UPDATE_MODE } from "../../shared/updates";

import { UpdatesState } from "./updates-state";

let testHome = "";
let state: UpdatesState;

beforeEach(async () => {
  testHome = await mkdtemp(path.join(os.tmpdir(), "llm-space-updates-"));
  state = new UpdatesState(testHome);
});

afterEach(async () => {
  await state.dispose();
  await rm(testHome, { recursive: true, force: true });
});

test("UpdatesState defaults the mode and serializes concurrent mutations", async () => {
  expect(await state.getMode()).toBe(DEFAULT_UPDATE_MODE);

  await Promise.all([
    state.setMode("manual"),
    state.setLastSeenHash("regular", "hash-regular"),
    state.setLastSeenHash("performance", "hash-performance"),
  ]);

  expect(await state.getMode()).toBe("manual");
  expect(await state.getLastSeenHash("regular")).toBe("hash-regular");
  expect(await state.getLastSeenHash("performance")).toBe(
    "hash-performance"
  );
});
