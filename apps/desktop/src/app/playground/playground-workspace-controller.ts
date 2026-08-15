import {
  parsePortableThreadSnapshot,
  type PortableThreadSnapshot,
  type Thread,
} from "@llm-space/core";
import type { AgentSpec, Playground } from "@llm-space/studio";
import {
  resolveSeed,
  type PromptExample,
  type SeedHost,
} from "@llm-space/ui/components/thread-playground/examples/prompts";

import type { PlaygroundClient } from "@/client/playground-client";

const BLANK_AGENT_SPEC: AgentSpec = {
  schemaVersion: 1,
  instructions: [],
  tools: [],
};

export interface SnapshotDocument {
  readonly text: string | (() => Promise<string>);
}

export interface PlaygroundWorkspaceControllerOptions {
  readonly client: Pick<PlaygroundClient, "create">;
  readonly importSnapshot: (
    snapshot: PortableThreadSnapshot
  ) => Promise<Playground>;
  readonly seedHost: SeedHost;
  readonly refreshCatalog: () => void | Promise<void>;
  readonly openPlayground: (playground: Playground) => void;
  readonly notifySuccess: (message: string) => void;
  readonly notifyError: (title: string, error?: unknown) => void;
}

/** Owns durable Playground creation and snapshot-import application behavior. */
export class PlaygroundWorkspaceController {
  constructor(private readonly _options: PlaygroundWorkspaceControllerOptions) {}

  async createBlank(): Promise<void> {
    await this._create({});
  }

  async createFromExample(example: PromptExample): Promise<void> {
    try {
      const [instructions, tools, messages, textVariables] = await Promise.all([
        resolveSeed(example.content, this._options.seedHost),
        resolveSeed(example.tools, this._options.seedHost),
        resolveSeed(example.messages, this._options.seedHost),
        resolveSeed(example.textVariables, this._options.seedHost),
      ]);
      await this._create({
        title: example.label,
        agentSpec: {
          schemaVersion: 1,
          instructions: instructions ? [instructions] : [],
          tools: tools ?? [],
          ...(textVariables === undefined
            ? {}
            : {
                variableVariants: {
                  active: "default",
                  variants: { default: textVariables },
                },
              }),
        },
        messages,
      });
    } catch (error) {
      this._options.notifyError("Unable to create Playground", error);
    }
  }

  async importDocuments(documents: readonly SnapshotDocument[]): Promise<void> {
    if (documents.length === 0) return;
    let imported = 0;
    for (const document of documents) {
      try {
        const text =
          typeof document.text === "function"
            ? await document.text()
            : document.text;
        const snapshot = parsePortableThreadSnapshot(JSON.parse(text));
        const playground = await this._options.importSnapshot(snapshot);
        this._options.openPlayground(playground);
        imported += 1;
      } catch {
        // One malformed snapshot must not block the remaining documents.
      }
    }
    await this._options.refreshCatalog();
    if (imported === 0) {
      this._options.notifyError(
        "No valid LLM Space Thread Snapshots were selected."
      );
      return;
    }
    this._options.notifySuccess(
      `Imported ${imported} Playground${imported === 1 ? "" : "s"}`
    );
  }

  private async _create(input: {
    readonly title?: string;
    readonly agentSpec?: AgentSpec;
    readonly messages?: NonNullable<Thread["context"]>["messages"];
  }): Promise<void> {
    try {
      const playground = await this._options.client.create({
        title: input.title,
        agentSpec: input.agentSpec ?? BLANK_AGENT_SPEC,
        conversation: {
          messages: input.messages ?? [
            {
              id: crypto.randomUUID(),
              role: "user",
              content: [{ type: "text", text: "" }],
            },
          ],
          state: {},
        },
      });
      await this._options.refreshCatalog();
      this._options.openPlayground(playground);
    } catch (error) {
      this._options.notifyError("Unable to create Playground", error);
    }
  }
}
