import { describe, expect, test } from "bun:test";

import type { ModelProviderGroup, Thread } from "@llm-space/core";

import { buildSharedThread } from "./thread-sharing";
import { ThreadSharingApplication } from "./thread-sharing-application";

function _model(
  provider: string,
  id: string,
  name: string
): ModelProviderGroup["models"][number] {
  return {
    provider,
    id,
    name,
    api: "openai-completions",
    baseUrl: "https://example.com",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

const PROVIDERS = [
  {
    id: "provider",
    name: "Provider",
    profiles: [],
    models: [_model("provider", "default-model", "Default Model")],
  },
] satisfies ModelProviderGroup[];

describe("buildSharedThread", () => {
  test("freezes the resolved default model and display name into the copy", () => {
    const thread: Thread = { title: "Local" };
    const shared = buildSharedThread(
      thread,
      PROVIDERS,
      { provider: "provider", id: "default-model" },
      "Shared"
    );

    expect(shared).toEqual({
      title: "Shared",
      model: { provider: "provider", id: "default-model" },
      modelName: "Default Model",
    });
    expect(thread).toEqual({ title: "Local" });
  });

  test("uses the first available model when the default is automatic", () => {
    expect(buildSharedThread({}, PROVIDERS, null)).toMatchObject({
      model: { provider: "provider", id: "default-model" },
      modelName: "Default Model",
    });
  });

  test("preserves an unresolved saved model for a useful viewer fallback", () => {
    const thread: Thread = {
      model: { provider: "missing", id: "legacy-model" },
    };
    expect(buildSharedThread(thread, [], null)).toEqual(thread);
  });
});

describe("ThreadSharingApplication", () => {
  test("builds a portable snapshot from the committed Playground identity", async () => {
    const playground = {
      schemaVersion: 1,
      id: "playground-1",
      title: "Committed Playground",
      sessionId: "session-1",
      lane: "main",
      leafId: "leaf-1",
      runtimeFormatVersion: 1,
      agentSpec: { schemaVersion: 1, instructions: ["Be useful"], tools: [] },
      conversation: { messages: [], state: {} },
      dirty: false,
      createdAt: 1,
      updatedAt: 2,
    } as const;
    const application = new ThreadSharingApplication(
      { loadPlayground: () => Promise.resolve(playground) } as never,
      {
        list: () => Promise.resolve([]),
        getDefault: () => Promise.resolve(null),
      } as never,
      {
        writeSnapshot: () => Promise.reject(new Error("unused")),
        readSnapshot: () => Promise.reject(new Error("unused")),
      } as never
    );

    expect(await application.read(playground.id)).toEqual({
      kind: "llm-space.thread-snapshot",
      schemaVersion: 1,
      source: {
        product: "playground",
        productId: "playground-1",
        sessionId: "session-1",
        lane: "main",
        leafId: "leaf-1",
      },
      thread: {
        title: "Committed Playground",
        context: { systemPrompt: "Be useful", tools: [], messages: [] },
      },
    });
  });

  test("imports a snapshot as a new Playground document", async () => {
    let createdDocument: unknown;
    const created = { id: "playground-new" };
    const application = new ThreadSharingApplication(
      {
        createPlayground: (document: unknown) => {
          createdDocument = document;
          return Promise.resolve(created);
        },
      } as never,
      {} as never,
      {
        writeSnapshot: () => Promise.reject(new Error("unused")),
        readSnapshot: () => Promise.reject(new Error("unused")),
      } as never
    );

    const result = await application.importSnapshot({
      kind: "llm-space.thread-snapshot",
      schemaVersion: 1,
      source: {
        product: "playground",
        productId: "playground-old",
        sessionId: "session-old",
        lane: "main",
        leafId: null,
      },
      thread: {
        title: "Imported",
        context: {
          systemPrompt: "Imported instructions",
          tools: [],
          messages: [],
        },
      },
    });

    expect(result.id).toBe(created.id);
    expect(createdDocument).toEqual({
      title: "Imported",
      agentSpec: {
        schemaVersion: 1,
        instructions: ["Imported instructions"],
        tools: [],
      },
      conversation: { messages: [], state: {} },
    });
  });
});
