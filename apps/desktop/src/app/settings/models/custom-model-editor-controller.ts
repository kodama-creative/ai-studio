import type { CustomModel } from "@llm-space/core";
import { inject, injectable } from "inversify";

import { DesktopModelCatalogController } from "../../models/desktop-model-catalog-controller";

export interface CustomModelEditorTarget {
  readonly providerId: string;
  readonly profileId: string;
  readonly originalModelId?: string;
}

export const CUSTOM_MODEL_EDITOR_TARGET = Symbol("CustomModelEditorTarget");

export type CustomModelEditorOperation = "idle" | "saving" | "testing";

export interface CustomModelEditorSnapshot {
  readonly operation: CustomModelEditorOperation;
}

export type CustomModelEditorResult =
  | { readonly type: "saved" }
  | { readonly type: "tested" }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "ignored" };

type Listener = () => void;

const IDLE_SNAPSHOT: CustomModelEditorSnapshot = { operation: "idle" };

/**
 * Owns one Custom Model editor session's mutually exclusive Save/Test effects.
 * Closing or changing target invalidates every in-flight result.
 */
@injectable()
export class CustomModelEditorController {
  private readonly _catalog: Pick<
    DesktopModelCatalogController,
    "upsertCustomModel" | "testModelConnection"
  >;
  private readonly _initialTarget?: CustomModelEditorTarget;
  private readonly _listeners = new Set<Listener>();
  private _epoch = 0;
  private _target: CustomModelEditorTarget | null = null;
  private _snapshot: CustomModelEditorSnapshot = IDLE_SNAPSHOT;

  constructor(
    @inject(DesktopModelCatalogController)
    catalog: Pick<
      DesktopModelCatalogController,
      "upsertCustomModel" | "testModelConnection"
    >,
    @inject(CUSTOM_MODEL_EDITOR_TARGET)
    initialTarget: CustomModelEditorTarget
  ) {
    this._catalog = catalog;
    this._initialTarget = initialTarget;
  }

  readonly getSnapshot = (): CustomModelEditorSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    if (this._initialTarget) this.open(this._initialTarget);
  }

  stop(): void {
    this.closeSession();
  }

  /** Start or retarget an editor session without resetting an identical owner. */
  open(target: CustomModelEditorTarget): void {
    if (this._target !== null && _sameTarget(this._target, target)) return;
    this._epoch += 1;
    this._target = { ...target };
    this._setSnapshot(IDLE_SNAPSHOT);
  }

  /** Invalidate current effects immediately on every dialog close path. */
  closeSession(): void {
    if (this._target === null) return;
    this._epoch += 1;
    this._target = null;
    this._setSnapshot(IDLE_SNAPSHOT);
  }

  save(model: CustomModel): Promise<CustomModelEditorResult> {
    return this._run("saving", model);
  }

  test(model: CustomModel): Promise<CustomModelEditorResult> {
    return this._run("testing", model);
  }

  private async _run(
    operation: Exclude<CustomModelEditorOperation, "idle">,
    model: CustomModel
  ): Promise<CustomModelEditorResult> {
    const target = this._target;
    if (target === null || this._snapshot.operation !== "idle") {
      return { type: "ignored" };
    }
    const epoch = this._epoch;
    this._setSnapshot({ operation });
    try {
      if (operation === "saving") {
        await this._catalog.upsertCustomModel(
          target.providerId,
          model,
          target.originalModelId
        );
      } else {
        await this._catalog.testModelConnection(
          target.providerId,
          model.id,
          model,
          target.profileId
        );
      }
    } catch (error) {
      if (!this._isCurrent(epoch, target, operation)) {
        return { type: "ignored" };
      }
      this._setSnapshot(IDLE_SNAPSHOT);
      return { type: "failed", error };
    }
    if (!this._isCurrent(epoch, target, operation)) {
      return { type: "ignored" };
    }
    this._setSnapshot(IDLE_SNAPSHOT);
    return { type: operation === "saving" ? "saved" : "tested" };
  }

  private _isCurrent(
    epoch: number,
    target: CustomModelEditorTarget,
    operation: CustomModelEditorOperation
  ): boolean {
    return (
      this._epoch === epoch &&
      this._target !== null &&
      _sameTarget(this._target, target) &&
      this._snapshot.operation === operation
    );
  }

  private _setSnapshot(snapshot: CustomModelEditorSnapshot): void {
    if (this._snapshot.operation === snapshot.operation) return;
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}

function _sameTarget(
  left: CustomModelEditorTarget,
  right: CustomModelEditorTarget
): boolean {
  return (
    left.providerId === right.providerId &&
    left.profileId === right.profileId &&
    left.originalModelId === right.originalModelId
  );
}
