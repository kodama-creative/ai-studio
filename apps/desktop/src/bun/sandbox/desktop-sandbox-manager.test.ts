import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SandboxWorkspaceLostError } from "@llm-space/runtime/node";
import { afterEach, describe, expect, test } from "bun:test";

import type {
  SandboxProvider,
  SandboxProviderSession
} from "@llm-space/runtime/node";

import { DesktopSandboxManager } from "./desktop-sandbox-manager";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root =>
    rm(root, { recursive: true, force: true })));
});

describe("DesktopSandboxManager", () => {
  test("retains one Sandbox binding across Turns and Host stop", async () => {
    const root = await _root();
    const provider = new FakeProvider();
    const manager = new DesktopSandboxManager({
      homePath: root,
      provider
    });
    await manager.start();

    await manager.prepareTurn({
      sessionId: "thread-one",
      turnId: "turn-one",
      seed: []
    });
    await manager.prepareTurn({
      sessionId: "thread-one",
      turnId: "turn-two",
      seed: []
    });
    expect(provider.expectedExisting).toEqual([false, true]);

    await manager.stop();
    expect(provider.stopped).toEqual(["thread-one"]);
    expect(JSON.parse(await readFile(
      path.join(root, "sandboxes", "registry.json"),
      "utf8"
    ))).toMatchObject({
      sessions: { "thread-one": { state: "active" } }
    });
  });

  test("persists honest loss and tombstoned cleanup", async () => {
    const root = await _root();
    const provider = new FakeProvider();
    const manager = new DesktopSandboxManager({ homePath: root, provider });
    await manager.start();
    await manager.prepareTurn({
      sessionId: "thread-lost",
      turnId: "turn-one",
      seed: []
    });
    provider.lost = true;

    expect(await _rejection(manager.prepareTurn({
      sessionId: "thread-lost",
      turnId: "turn-two",
      seed: []
    }))).toBeInstanceOf(SandboxWorkspaceLostError);
    expect(await manager.status("thread-lost")).toMatchObject({
      state: "unavailable",
      message: expect.stringContaining("missing")
    });

    provider.deleteFailures = 1;
    expect(await _rejection(manager.delete("thread-lost"))).toBeInstanceOf(
      Error
    );
    expect(JSON.parse(await readFile(
      path.join(root, "sandboxes", "registry.json"),
      "utf8"
    ))).toMatchObject({
      sessions: { "thread-lost": { state: "cleanupPending" } }
    });
    await manager.start();
    expect(await manager.status("thread-lost")).toEqual({ state: "ready" });
  });
});

class FakeProvider implements SandboxProvider {
  expectedExisting: boolean[] = [];
  stopped: string[] = [];
  lost = false;
  deleteFailures = 0;

  async readiness() { return { state: "ready" as const }; }

  async acquire(input: {
    expectedExisting?: boolean;
    seed: readonly never[];
    sessionId: string;
  }): Promise<SandboxProviderSession> {
    this.expectedExisting.push(input.expectedExisting === true);
    if (this.lost && input.expectedExisting) {
      throw new SandboxWorkspaceLostError();
    }
    return {
      sessionId: input.sessionId,
      executionEnv: {} as never,
      async stageTurn() { return []; },
      async workspaceManifest() { return ["README.md"]; }
    };
  }

  async stop(sessionId: string) { this.stopped.push(sessionId); }

  async delete() {
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw new Error("cleanup failed");
    }
  }
}

async function _root(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-sandbox-manager-"));
  ROOTS.push(root);
  return root;
}

async function _rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}
