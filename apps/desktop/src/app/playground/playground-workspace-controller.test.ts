import { describe, expect, test } from "bun:test";

import type { PortableThreadSnapshot } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";
import type { PromptExample } from "@llm-space/ui/components/thread-playground/examples/prompts";

import type { PlaygroundClient } from "@/shared/playground-rpc";

import type { MainTabsController } from "../tabs/main-tabs-controller";

import { PlaygroundWorkspaceController } from "./playground-workspace-controller";

type CreatePlayground = PlaygroundClient["create"];
type ListPlaygrounds = PlaygroundClient["list"];

describe("PlaygroundWorkspaceController", () => {
  test("resolves one example and opens the created durable Playground", async () => {
    const fixture = _fixture();
    await _start(fixture);
    const example = {
      type: "example",
      id: "agent-example",
      label: "Agent Example",
      fileStem: "agent-example",
      description: "Example",
      content: () => Promise.resolve("Use available skills."),
      tools: () => Promise.resolve([]),
      messages: () => Promise.resolve([
        {
          id: "user-example",
          role: "user" as const,
          content: [{ type: "text" as const, text: "hello" }],
        },
      ]),
      textVariables: () => Promise.resolve({ audience: "developer" }),
      icon: (() => null) as unknown as PromptExample["icon"],
    } satisfies PromptExample;

    await fixture.controller.createFromExample(example);

    expect(fixture.created).toEqual([
      {
        title: "Agent Example",
        agentSpec: {
          schemaVersion: 1,
          instructions: ["Use available skills."],
          tools: [],
          variableVariants: {
            active: "default",
            variants: { default: { audience: "developer" } },
          },
        },
        conversation: {
          messages: [
            {
              id: "user-example",
              role: "user",
              content: [{ type: "text", text: "hello" }],
            },
          ],
          state: {},
        },
      },
    ]);
    expect(fixture.events).toEqual(["refresh", "open:playground-created"]);
  });

  test("imports every valid versioned snapshot and reports invalid documents once", async () => {
    const fixture = _fixture();
    await _start(fixture);
    await fixture.controller.importDocuments([
      { text: () => Promise.resolve(JSON.stringify(_snapshot("one"))) },
      { text: () => Promise.resolve("not json") },
      { text: () => Promise.resolve(JSON.stringify(_snapshot("two"))) },
    ]);

    expect(fixture.imported.map((snapshot) => snapshot.source.productId)).toEqual([
      "one",
      "two",
    ]);
    expect(fixture.events).toEqual([
      "open:import-one",
      "open:import-two",
      "refresh",
      "success:Imported 2 Playgrounds",
    ]);

    fixture.events.length = 0;
    await fixture.controller.importDocuments([
      { text: () => Promise.resolve(JSON.stringify({ title: "bare" })) },
    ]);
    expect(fixture.events).toEqual([
      "refresh",
      "error:No valid LLM Space Thread Snapshots were selected.",
    ]);
  });

  test("contains create failures and reports them through its notification seam", async () => {
    const fixture = _fixture({
      create: () => Promise.reject(new Error("storage unavailable")),
    });
    await _start(fixture);

    await fixture.controller.createBlank();

    expect(fixture.events).toEqual([
      "error:Unable to create Playground:storage unavailable",
    ]);
  });

  test("keeps a pane projection authoritative over an older catalog read", async () => {
    const stale = _deferred<readonly Playground[]>();
    let reads = 0;
    const fixture = _fixture({
      list: () => {
        reads += 1;
        return reads === 1 ? Promise.resolve([]) : stale.promise;
      },
    });
    await _start(fixture);

    const refresh = fixture.controller.refresh();
    fixture.controller.acceptProjection(_playground("one", "Latest title"));
    stale.resolve([_playground("one", "Older title")]);
    await refresh;

    expect(fixture.controller.getSnapshot().playgrounds).toEqual([
      _playground("one", "Latest title"),
    ]);
    fixture.controller.stop();
  });
});

function _fixture(overrides: {
  readonly create?: CreatePlayground;
  readonly list?: ListPlaygrounds;
} = {}) {
  const created: Parameters<CreatePlayground>[0][] = [];
  const imported: PortableThreadSnapshot[] = [];
  const events: string[] = [];
  const createdPlayground = _playground("playground-created", "Created");
  const controller = new PlaygroundWorkspaceController(
    {
      create:
        overrides.create ??
        ((input) => {
          created.push(input);
          return Promise.resolve(createdPlayground);
        }),
      list:
        overrides.list ??
        (() => {
          events.push("refresh");
          return Promise.resolve([]);
        }),
    },
    {
      importSnapshot: (snapshot) => {
        imported.push(snapshot);
        return Promise.resolve(
          _playground(`import-${snapshot.source.productId}`, "Imported")
        );
      },
    },
    {
      skills: {
        getSettings: () => Promise.resolve({ discoveryPaths: [] }),
        listAvailable: () => Promise.resolve([]),
        listSkills: () => Promise.resolve([]),
      },
      paths: {
        ensureRootDir: () => Promise.resolve("/workspace"),
      },
    },
    {
      dispatch: (intent: { type: string; playgroundId?: string }) => {
        if (intent.type === "open" && intent.playgroundId !== undefined) {
          events.push(`open:${intent.playgroundId}`);
        }
      },
    } as unknown as MainTabsController,
    {
      success: (message: string) => events.push(`success:${message}`),
      error: (title: string, error?: unknown) =>
        events.push(
          `error:${title}${error instanceof Error ? `:${error.message}` : ""}`
        ),
    }
  );
  return { controller, created, events, imported };
}

async function _start(fixture: ReturnType<typeof _fixture>): Promise<void> {
  fixture.controller.start();
  await _eventually(() => fixture.controller.getSnapshot().loading, false);
  fixture.events.length = 0;
}

function _snapshot(productId: string): PortableThreadSnapshot {
  return {
    kind: "llm-space.thread-snapshot",
    schemaVersion: 1,
    source: {
      product: "playground",
      productId,
      sessionId: `session-${productId}`,
      lane: "main",
      leafId: null,
    },
    thread: { title: productId },
  };
}

function _playground(id: string, title: string): Playground {
  return {
    schemaVersion: 1,
    id,
    title,
    sessionId: `session-${id}`,
    lane: "main",
    leafId: null,
    runtimeFormatVersion: 1,
    agentSpec: { schemaVersion: 1, instructions: [], tools: [] },
    conversation: { messages: [], state: {} },
    dirty: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (read() === expected) return;
    await Promise.resolve();
  }
  expect(read()).toBe(expected);
}
