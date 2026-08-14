import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BunSqliteRuntimeBindingStore,
  RuntimeBindingConflictError,
  type RuntimeBinding,
} from "./bun-sqlite-runtime-binding-store";

const BINDING: RuntimeBinding = {
  formatVersion: 1,
  agent: {
    agentSpecId: "assistant",
    projectId: "project-1",
    sourceRevision: "abc123",
  },
  model: { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
  systemPrompt: "You are precise.",
  tools: [{ name: "read", implementationId: "builtin/read@1", replay: "safe" }],
};

test("stores immutable bindings idempotently in the shared database", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-binding-"));
  const store = new BunSqliteRuntimeBindingStore({
    path: join(root, "studio.sqlite"),
  });
  try {
    const first = store.put({ id: "binding-1", binding: BINDING });
    const repeated = store.put({
      id: "binding-1",
      binding: structuredClone(BINDING),
    });

    expect(repeated).toEqual(first);
    expect(store.resolve(first)).toEqual(BINDING);
    const resolved = store.resolve(first);
    resolved.systemPrompt = "mutated read";
    expect(store.resolve(first).systemPrompt).toBe("You are precise.");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects reusing a binding id for different immutable content", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-binding-"));
  const store = new BunSqliteRuntimeBindingStore({
    path: join(root, "studio.sqlite"),
  });
  try {
    store.put({ id: "binding-1", binding: BINDING });
    expect(() =>
      store.put({
        id: "binding-1",
        binding: { ...BINDING, systemPrompt: "different" },
      })
    ).toThrow(RuntimeBindingConflictError);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
