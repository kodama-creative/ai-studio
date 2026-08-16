import type { SeedreamImageModelDefinition } from "@llm-space/core";

export type ImageModelEditorOperation = "idle" | "saving";

export interface ImageModelEditorSnapshot {
  readonly operation: ImageModelEditorOperation;
}

export type ImageModelEditorResult =
  | { readonly type: "saved" }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "ignored" };

export interface ImageModelEditorControllerOptions {
  readonly save: (
    model: SeedreamImageModelDefinition,
    originalModelId?: string
  ) => Promise<void>;
}

type Listener = () => void;

const IDLE_SNAPSHOT: ImageModelEditorSnapshot = { operation: "idle" };

/**
 * Owns one Image Model editor session and contains its Save operation. Closing
 * or retargeting the editor invalidates the in-flight result immediately.
 */
export class ImageModelEditorController {
  private readonly _listeners = new Set<Listener>();
  private _epoch = 0;
  private _originalModelId: string | null | undefined = null;
  private _snapshot: ImageModelEditorSnapshot = IDLE_SNAPSHOT;

  constructor(
    private readonly _options: ImageModelEditorControllerOptions,
    private readonly _initialOriginalModelId: string | undefined = undefined
  ) {}

  readonly getSnapshot = (): ImageModelEditorSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.open(this._initialOriginalModelId);
  }

  stop(): void {
    this.closeSession();
  }

  /** Start a create/edit session; `undefined` identifies a fresh model. */
  open(originalModelId?: string): void {
    if (
      this._originalModelId !== null &&
      this._originalModelId === originalModelId
    ) {
      return;
    }
    this._epoch += 1;
    this._originalModelId = originalModelId;
    this._setSnapshot(IDLE_SNAPSHOT);
  }

  /** Invalidate current effects immediately on every dialog close path. */
  closeSession(): void {
    if (this._originalModelId === null) return;
    this._epoch += 1;
    this._originalModelId = null;
    this._setSnapshot(IDLE_SNAPSHOT);
  }

  async save(
    model: SeedreamImageModelDefinition
  ): Promise<ImageModelEditorResult> {
    const originalModelId = this._originalModelId;
    if (originalModelId === null || this._snapshot.operation !== "idle") {
      return { type: "ignored" };
    }
    const epoch = this._epoch;
    this._setSnapshot({ operation: "saving" });
    try {
      await this._options.save(model, originalModelId);
    } catch (error) {
      if (!this._isCurrent(epoch, originalModelId)) {
        return { type: "ignored" };
      }
      this._setSnapshot(IDLE_SNAPSHOT);
      return { type: "failed", error };
    }
    if (!this._isCurrent(epoch, originalModelId)) {
      return { type: "ignored" };
    }
    this._setSnapshot(IDLE_SNAPSHOT);
    return { type: "saved" };
  }

  private _isCurrent(
    epoch: number,
    originalModelId: string | undefined
  ): boolean {
    return (
      this._epoch === epoch &&
      this._originalModelId === originalModelId &&
      this._snapshot.operation === "saving"
    );
  }

  private _setSnapshot(snapshot: ImageModelEditorSnapshot): void {
    if (this._snapshot.operation === snapshot.operation) return;
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
