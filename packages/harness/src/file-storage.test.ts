import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSessionRepository, JsonlSessionEventLog } from "./file-storage";
import type { HarnessSessionSnapshot } from "./protocol";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("file session repository restores a snapshot in a new host instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-storage-"));
  ROOTS.push(root);
  const snapshot: HarnessSessionSnapshot = {
    id: "session/local-example",
    agentId: "@llm-space/example-basic-agent",
    generationId: "generation-1",
    mode: "conversation",
    status: "waiting",
    messages: [{ id: "user-1", role: "user", content: "hello" }],
    state: { count: 1 },
    turnSequence: 1,
    eventSequence: 4,
    createdAt: 10,
    updatedAt: 20,
  };

  await new FileSessionRepository(root).save(snapshot);
  const restored = await new FileSessionRepository(root).load(snapshot.id);

  expect(restored).toEqual(snapshot);
});

test("JSONL session event log replays persisted events from a cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-events-"));
  ROOTS.push(root);
  const first = new JsonlSessionEventLog(root);
  await first.append({
    sessionId: "session/local-example",
    sequence: 1,
    timestamp: 10,
    event: {
      type: "session.started",
      agentId: "@llm-space/example-basic-agent",
      generationId: "generation-1",
    },
  });
  await first.append({
    sessionId: "session/local-example",
    sequence: 2,
    timestamp: 20,
    event: { type: "session.waiting" },
  });

  const replayed = [];
  for await (const event of new JsonlSessionEventLog(root).read(
    "session/local-example",
    { afterSequence: 1 }
  )) {
    replayed.push(event);
  }

  expect(replayed).toEqual([
    {
      sessionId: "session/local-example",
      sequence: 2,
      timestamp: 20,
      event: { type: "session.waiting" },
    },
  ]);
});

test("JSONL event followers wake across adapter instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-follow-"));
  ROOTS.push(root);
  const sessionId = "session/cross-instance";
  const iterator = new JsonlSessionEventLog(root)
    .read(sessionId, { follow: true })
    [Symbol.asyncIterator]();
  const next = iterator.next();

  await new JsonlSessionEventLog(root).append({
    sessionId,
    sequence: 1,
    timestamp: 10,
    event: { type: "session.waiting" },
  });

  expect(await next).toEqual({
    done: false,
    value: {
      sessionId,
      sequence: 1,
      timestamp: 10,
      event: { type: "session.waiting" },
    },
  });
  await iterator.return?.();
});

test("file storage rejects malformed persisted protocol records", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-invalid-"));
  ROOTS.push(root);
  const sessionId = "session/invalid";
  const key = Buffer.from(sessionId).toString("base64url");
  await mkdir(join(root, "sessions"), { recursive: true });
  await mkdir(join(root, "events"), { recursive: true });
  await writeFile(join(root, "sessions", `${key}.json`), "{}\n");
  await writeFile(join(root, "events", `${key}.jsonl`), "{}\n");

  expect(
    await _rejectionMessage(() =>
      new FileSessionRepository(root).load(sessionId)
    )
  ).toContain("Invalid session snapshot");
  const readEvents = async () => {
    for await (const event of new JsonlSessionEventLog(root).read(sessionId)) {
      // Consume through the public async-iterable interface.
      void event;
    }
  };
  expect(await _rejectionMessage(readEvents)).toContain(
    "Invalid session event at line 1"
  );
});

async function _rejectionMessage(
  action: () => Promise<unknown>
): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected action to reject.");
}
