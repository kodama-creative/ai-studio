import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HarnessSessionSnapshot } from "../../session/protocol";

import {
  FileChannelBindingRepository,
  FileSessionCommandQueue,
  FileSessionRepository,
  JsonlSessionEventLog,
  createFileSessionStorage,
} from ".";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("file session storage persists independent Run resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-runs-"));
  ROOTS.push(root);
  const storage = createFileSessionStorage(root);
  await storage.runRepository.create({
    schemaVersion: 1,
    id: "run-1",
    owner: { type: "session", sessionId: "session-1" },
    triggerMessageId: "message-1",
    status: "completed",
    createdAt: 10,
    startedAt: 11,
    completedAt: 12,
  });

  expect(
    await createFileSessionStorage(root).runRepository.listByOwner({
      type: "session",
      sessionId: "session-1",
    })
  ).toEqual([
    {
      schemaVersion: 1,
      id: "run-1",
      owner: { type: "session", sessionId: "session-1" },
      triggerMessageId: "message-1",
      status: "completed",
      createdAt: 10,
      startedAt: 11,
      completedAt: 12,
    },
  ]);
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

test("file session repository atomically creates a Session once", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-create-"));
  ROOTS.push(root);
  const snapshot: HarnessSessionSnapshot = {
    id: "session/atomic",
    agentId: "fixture-agent",
    generationId: "generation-1",
    mode: "conversation",
    status: "waiting",
    messages: [],
    state: {},
    turnSequence: 0,
    eventSequence: 0,
    createdAt: 10,
    updatedAt: 10,
  };
  const results = await Promise.all([
    new FileSessionRepository(root).create(snapshot),
    new FileSessionRepository(root).create({
      ...snapshot,
      generationId: "generation-2",
    }),
  ]);

  expect(results.toSorted()).toEqual(["created", "existing"]);
  expect(
    ["generation-1", "generation-2"].includes(
      (await new FileSessionRepository(root).load(snapshot.id))?.generationId ??
        ""
    )
  ).toBe(true);
});

test("file Channel bindings atomically preserve the first claimed Session", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-bindings-"));
  ROOTS.push(root);
  const first = new FileChannelBindingRepository(root);
  const binding = {
    channelId: "http",
    address: "tenant-1/conversation-1",
    sessionId: "session-1",
    initiator: null,
    createdAt: 10,
  };

  expect((await first.claim(binding)).status).toBe("claimed");
  expect(
    (
      await new FileChannelBindingRepository(root).claim({
        ...binding,
        sessionId: "session-2",
      })
    ).binding.sessionId
  ).toBe("session-1");
  expect(await first.resolve(binding)).toEqual(binding);
});

test("file command queue restores and acknowledges pending commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-commands-"));
  ROOTS.push(root);
  const sessionId = "session/local-example";
  await new FileSessionCommandQueue(root).enqueue({
    id: "command-1",
    sessionId,
    turnId: "turn-1",
    message: "hello",
    principal: null,
    createdAt: 10,
  });

  const restored = new FileSessionCommandQueue(root);
  await restored.recover(sessionId, { now: 0, leaseExpiresAt: 100 });
  const lease = await restored.claim(sessionId, {
    now: 0,
    leaseExpiresAt: 100,
  });

  expect(lease?.command).toMatchObject({
    id: "command-1",
    sessionId,
    turnId: "turn-1",
    message: "hello",
  });
  await lease?.complete();
  expect(
    await restored.claim(sessionId, { now: 0, leaseExpiresAt: 100 })
  ).toBeUndefined();
  expect(
    (
      await restored.enqueue({
        id: "command-1",
        sessionId,
        turnId: "turn-1",
        message: "hello",
        principal: null,
        createdAt: 99,
      })
    ).status
  ).toBe("duplicate");
});

test("file command queue requeues an interrupted claim during recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-recover-"));
  ROOTS.push(root);
  const sessionId = "session/interrupted";
  const first = new FileSessionCommandQueue(root);
  await first.enqueue({
    id: "command-interrupted",
    sessionId,
    turnId: "turn-interrupted",
    message: "resume me",
    principal: null,
    createdAt: 20,
  });
  expect(
    (await first.claim(sessionId, { now: 0, leaseExpiresAt: 10 }))?.command.id
  ).toBe("command-interrupted");

  const restarted = new FileSessionCommandQueue(root);
  expect(
    (
      await restarted.recover(sessionId, {
        now: 5,
        leaseExpiresAt: 20,
      })
    ).active[0]?.command.id
  ).toBe("command-interrupted");
  expect(
    await restarted.claim(sessionId, { now: 5, leaseExpiresAt: 20 })
  ).toBeUndefined();
  const recovered = await restarted.recover(sessionId, {
    now: 11,
    leaseExpiresAt: 20,
  });

  expect(recovered.recovered[0]?.command.id).toBe("command-interrupted");
  await recovered.recovered[0]?.release();
  expect(
    (await restarted.claim(sessionId, { now: 11, leaseExpiresAt: 20 }))?.command
      .id
  ).toBe("command-interrupted");
});

test("file command queue fences a stale lease owner after recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-fencing-"));
  ROOTS.push(root);
  const sessionId = "session/fencing";
  const queue = new FileSessionCommandQueue(root);
  await queue.enqueue({
    id: "command-fencing",
    sessionId,
    turnId: "turn-fencing",
    message: "run once",
    principal: null,
    createdAt: 10,
  });
  const stale = await queue.claim(sessionId, {
    now: 0,
    leaseExpiresAt: 1,
  });
  const current = (
    await new FileSessionCommandQueue(root).recover(sessionId, {
      now: 2,
      leaseExpiresAt: 100,
    })
  ).recovered[0];

  await stale?.complete();
  await stale?.release();
  expect(stale?.renew(200)).rejects.toThrow();
  expect(
    (
      await new FileSessionCommandQueue(root).recover(sessionId, {
        now: 2,
        leaseExpiresAt: 100,
      })
    ).active[0]?.command.id
  ).toBe("command-fencing");
  await current?.complete();
  expect(
    await new FileSessionCommandQueue(root).claim(sessionId, {
      now: 2,
      leaseExpiresAt: 100,
    })
  ).toBeUndefined();
});

test("file command queue preserves enqueue order when timestamps match", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-fifo-"));
  ROOTS.push(root);
  const queue = new FileSessionCommandQueue(root);
  const sessionId = "session/fifo";
  await queue.enqueue({
    id: "command-z",
    sessionId,
    turnId: "turn-first",
    message: "first",
    principal: null,
    createdAt: 10,
  });
  await queue.enqueue({
    id: "command-a",
    sessionId,
    turnId: "turn-second",
    message: "second",
    principal: null,
    createdAt: 10,
  });

  const first = await queue.claim(sessionId, {
    now: 0,
    leaseExpiresAt: 100,
  });
  expect(first?.command.turnId).toBe("turn-first");
  await first?.complete();
  const second = await queue.claim(sessionId, {
    now: 0,
    leaseExpiresAt: 100,
  });
  expect(second?.command.turnId).toBe("turn-second");
});

test("file command queue allocates FIFO sequence across adapter instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-fifo-race-"));
  ROOTS.push(root);
  const sessionId = "session/fifo-race";
  const accepted = await Promise.all([
    new FileSessionCommandQueue(root).enqueue({
      id: "command-left",
      sessionId,
      turnId: "turn-left",
      message: "left",
      principal: null,
      createdAt: 10,
    }),
    new FileSessionCommandQueue(root).enqueue({
      id: "command-right",
      sessionId,
      turnId: "turn-right",
      message: "right",
      principal: null,
      createdAt: 10,
    }),
  ]);
  const expectedOrder = accepted
    .map((result) => result.command)
    .toSorted((left, right) => left.sequence - right.sequence)
    .map((command) => command.id);
  const consumer = new FileSessionCommandQueue(root);
  const first = await consumer.claim(sessionId, {
    now: 0,
    leaseExpiresAt: 100,
  });
  await first?.complete();
  const second = await consumer.claim(sessionId, {
    now: 0,
    leaseExpiresAt: 100,
  });

  expect(accepted.map((result) => result.command.sequence).toSorted()).toEqual([
    1, 2,
  ]);
  expect([first?.command.id, second?.command.id]).toEqual(expectedOrder);
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
