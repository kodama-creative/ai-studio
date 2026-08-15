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
  readonly client: Pick<PlaygroundClient, "create" | "list">;
  readonly importSnapshot: (
    snapshot: PortableThreadSnapshot
  ) => Promise<Playground>;
  readonly seedHost: SeedHost;
  readonly openPlayground: (playground: Playground) => void;
  readonly notifySuccess: (message: string) => void;
  readonly notifyError: (title: string, error?: unknown) => void;
}

export interface PlaygroundWorkspaceSnapshot {
  readonly playgrounds: readonly Playground[];
  readonly loading: boolean;
}

type Listener = () => void;

/**
 * Owns the Main window's durable Playground catalog and its creation/import
 * behavior. Saved pane projections enter through `acceptProjection`, so list
 * presentation cannot drift from the latest durable title or metadata.
 */
export class PlaygroundWorkspaceController {
  private readonly _listeners = new Set<Listener>();
  private readonly _projections = new Map<string, Playground>();
  private _lifecycle = 0;
  private _request = 0;
  private _started = false;
  private _snapshot: PlaygroundWorkspaceSnapshot = {
    playgrounds: [],
    loading: true,
  };

  constructor(private readonly _options: PlaygroundWorkspaceControllerOptions) {}

  readonly getSnapshot = (): PlaygroundWorkspaceSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Start or restart the catalog read lifecycle. */
  start(): void {
    if (this._started) this.stop();
    this._started = true;
    this._lifecycle += 1;
    this._setSnapshot({ ...this._snapshot, loading: true });
    void this.refresh();
  }

  /** Invalidate catalog reads while leaving the last projection renderable. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._lifecycle += 1;
    this._request += 1;
  }

  /** Refresh from persistence while preserving newer pane projections. */
  async refresh(): Promise<void> {
    if (!this._started) return;
    const lifecycle = this._lifecycle;
    const request = ++this._request;
    try {
      const playgrounds = await this._options.client.list();
      if (!this._isCurrent(lifecycle, request)) return;
      this._setSnapshot({
        playgrounds: this._mergeProjections(playgrounds),
        loading: false,
      });
    } catch (error) {
      if (!this._isCurrent(lifecycle, request)) return;
      this._setSnapshot({ ...this._snapshot, loading: false });
      this._options.notifyError("Unable to refresh Playgrounds", error);
    }
  }

  /** Accept one durable pane projection into both current and future lists. */
  readonly acceptProjection = (playground: Playground): void => {
    this._projections.set(playground.id, playground);
    const index = this._snapshot.playgrounds.findIndex(
      (candidate) => candidate.id === playground.id
    );
    const playgrounds =
      index === -1
        ? [...this._snapshot.playgrounds, playground]
        : this._snapshot.playgrounds.map((candidate) =>
            candidate.id === playground.id ? playground : candidate
          );
    this._setSnapshot({ ...this._snapshot, playgrounds });
  };

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
        this.acceptProjection(playground);
        this._options.openPlayground(playground);
        imported += 1;
      } catch {
        // One malformed snapshot must not block the remaining documents.
      }
    }
    await this.refresh();
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
      this.acceptProjection(playground);
      await this.refresh();
      this._options.openPlayground(playground);
    } catch (error) {
      this._options.notifyError("Unable to create Playground", error);
    }
  }

  private _mergeProjections(
    playgrounds: readonly Playground[]
  ): readonly Playground[] {
    const merged = playgrounds.map((playground) => {
      const projection = this._projections.get(playground.id);
      if (projection === undefined) return playground;
      if (
        playground.updatedAt > projection.updatedAt ||
        JSON.stringify(playground) === JSON.stringify(projection)
      ) {
        this._projections.delete(playground.id);
        return playground;
      }
      return projection;
    });
    const known = new Set(merged.map((playground) => playground.id));
    for (const projection of this._projections.values()) {
      if (!known.has(projection.id)) merged.push(projection);
    }
    return merged;
  }

  private _isCurrent(lifecycle: number, request: number): boolean {
    return (
      this._started &&
      this._lifecycle === lifecycle &&
      this._request === request
    );
  }

  private _setSnapshot(snapshot: PlaygroundWorkspaceSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
