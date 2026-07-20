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

  test("blocks Run until staged attachments commit or compensate", async () => {
    const root = await _root();
    const provider = new FakeProvider();
    const manager = new DesktopSandboxManager({ homePath: root, provider });
    await manager.start();
    const input = {
      sessionId: "thread-attachments",
      messageId: "message-one",
      turnId: "turn-one",
      seed: [],
      attachments: [{
        id: "attachment-one",
        name: "notes.txt",
        fingerprint: "a".repeat(64),
        content: new TextEncoder().encode("notes")
      }]
    };

    const staged = await manager.stageAttachments(input);
    expect(await _rejection(manager.prepareTurn({
      sessionId: input.sessionId,
      turnId: "run-one",
      seed: []
    }))).toMatchObject({ message: "Sandbox attachment staging is incomplete." });
    await manager.abortAttachmentStaging(input);
    expect(provider.discarded).toEqual(["turn-one"]);
    await manager.prepareTurn({
      sessionId: input.sessionId,
      turnId: "run-after-abort",
      seed: []
    });

    const restaged = await manager.stageAttachments(input);
    await manager.completeAttachmentStaging({
      sessionId: input.sessionId,
      messageId: input.messageId,
      attachments: restaged
    });
    await manager.prepareTurn({
      sessionId: input.sessionId,
      turnId: "run-after-commit",
      seed: []
    });
    expect(staged).toEqual(restaged);
  });

  test("reconciles a crash after descriptor persistence", async () => {
    const root = await _root();
    const provider = new FakeProvider();
    const first = new DesktopSandboxManager({ homePath: root, provider });
    await first.start();
    const staged = await first.stageAttachments({
      sessionId: "thread-reconcile",
      messageId: "message-one",
      turnId: "turn-one",
      seed: [],
      attachments: [{
        id: "attachment-one",
        name: "notes.txt",
        fingerprint: "a".repeat(64),
        content: new TextEncoder().encode("notes")
      }]
    });

    const restarted = new DesktopSandboxManager({ homePath: root, provider });
    await restarted.start();
    await restarted.reconcileAttachmentStaging("thread-reconcile", {
      "message-one": staged
    });
    await restarted.prepareTurn({
      sessionId: "thread-reconcile",
      turnId: "run-after-restart",
      seed: []
    });
  });
});

class FakeProvider implements SandboxProvider {
  expectedExisting: boolean[] = [];
  stopped: string[] = [];
  discarded: string[] = [];
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
      discardTurn: async ({ turnId }) => { this.discarded.push(turnId); },
      async stageTurn({ attachments, turnId }) {
        return attachments.map(attachment => ({
          id: attachment.id,
          name: attachment.name,
          fingerprint: attachment.fingerprint,
          path: `/workspace/.llm-space-attachments-${turnId}/${attachment.name}`,
          size: attachment.content.byteLength
        }));
      },
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
