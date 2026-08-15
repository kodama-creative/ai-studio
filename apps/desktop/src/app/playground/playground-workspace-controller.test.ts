import { describe, expect, test } from "bun:test";

import type { PortableThreadSnapshot } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";
import type { PromptExample } from "@llm-space/ui/components/thread-playground/examples/prompts";

import {
  PlaygroundWorkspaceController,
  type PlaygroundWorkspaceControllerOptions,
} from "./playground-workspace-controller";

describe("PlaygroundWorkspaceController", () => {
  test("resolves one example and opens the created durable Playground", async () => {
    const fixture = _fixture();
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

    await fixture.controller.createBlank();

    expect(fixture.events).toEqual([
      "error:Unable to create Playground:storage unavailable",
    ]);
  });
});

function _fixture(overrides: {
  readonly create?: PlaygroundWorkspaceControllerOptions["client"]["create"];
} = {}) {
  const created: Parameters<PlaygroundWorkspaceControllerOptions["client"]["create"]>[0][] = [];
  const imported: PortableThreadSnapshot[] = [];
  const events: string[] = [];
  const createdPlayground = _playground("playground-created", "Created");
  const controller = new PlaygroundWorkspaceController({
    client: {
      create:
        overrides.create ??
        ((input) => {
          created.push(input);
          return Promise.resolve(createdPlayground);
        }),
    },
    importSnapshot: (snapshot) => {
      imported.push(snapshot);
      return Promise.resolve(
        _playground(`import-${snapshot.source.productId}`, "Imported")
      );
    },
    seedHost: {
      skills: {
        getSettings: () => Promise.resolve({ discoveryPaths: [] }),
        listAvailable: () => Promise.resolve([]),
        listSkills: () => Promise.resolve([]),
      },
      paths: {
        ensureRootDir: () => Promise.resolve("/workspace"),
      },
    },
    refreshCatalog: () => {
      events.push("refresh");
    },
    openPlayground: (playground) => events.push(`open:${playground.id}`),
    notifySuccess: (message) => events.push(`success:${message}`),
    notifyError: (title, error) =>
      events.push(
        `error:${title}${error instanceof Error ? `:${error.message}` : ""}`
      ),
  });
  return { controller, created, events, imported };
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
