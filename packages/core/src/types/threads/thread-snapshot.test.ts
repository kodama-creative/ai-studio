import { expect, test } from "bun:test";

import {
  THREAD_SNAPSHOT_KIND,
  THREAD_SNAPSHOT_SCHEMA_VERSION,
  threadFromSnapshotDocument,
} from "./thread-snapshot";

const THREAD = {
  title: "Portable Thread",
  context: {
    messages: [
      {
        id: "user-1",
        role: "user" as const,
        content: [{ type: "text" as const, text: "hello" }],
      },
    ],
  },
};

test("requires the versioned portable snapshot envelope", () => {
  expect(() => threadFromSnapshotDocument(THREAD)).toThrow();
  expect(
    threadFromSnapshotDocument({
      kind: THREAD_SNAPSHOT_KIND,
      schemaVersion: THREAD_SNAPSHOT_SCHEMA_VERSION,
      source: {
        product: "playground",
        productId: "playground-1",
        sessionId: "session-1",
        lane: "main",
        leafId: null,
      },
      thread: THREAD,
    })
  ).toMatchObject(THREAD);
});
