import type { SeedreamImageModelDefinition } from "@llm-space/core";
import { inject, injectable } from "inversify";

import { DesktopModelCatalogController } from "../../models/desktop-model-catalog-controller";

export const IMAGE_MODEL_EDITOR_TARGET = Symbol("ImageModelEditorTarget");

export interface ImageModelEditorTarget {
  readonly originalModelId?: string;
}

export type ImageModelEditorOperation = "idle" | "saving";

export interface ImageModelEditorSnapshot {
  readonly operation: ImageModelEditorOperation;
}

export type ImageModelEditorResult =
  | { readonly type: "saved" }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "ignored" };

type Listener = () => void;

const IDLE_SNAPSHOT: ImageModelEditorSnapshot = { operation: "idle" };

/**
 * Owns one Image Model editor session and contains its Save operation. Closing
 * or retargeting the editor invalidates the in-flight result immediately.
 */
@injectable()
export class ImageModelEditorController {
  private readonly _catalog: Pick<
    DesktopModelCatalogController,
    "upsertCustomImageModel"
  >;
  private readonly _target: ImageModelEditorTarget;
  private readonly _listeners = new Set<Listener>();
  private _epoch = 0;
  private _originalModelId: string | null | undefined = null;
  private _snapshot: ImageModelEditorSnapshot = IDLE_SNAPSHOT;

  constructor(
    @inject(DesktopModelCatalogController)
    catalog: Pick<DesktopModelCatalogController, "upsertCustomImageModel">,
    @inject(IMAGE_MODEL_EDITOR_TARGET)
    target: ImageModelEditorTarget
  ) {
    this._catalog = catalog;
    this._target = target;
  }

  readonly getSnapshot = (): ImageModelEditorSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.open(this._target.originalModelId);
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
      await this._catalog.upsertCustomImageModel(model, originalModelId);
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
