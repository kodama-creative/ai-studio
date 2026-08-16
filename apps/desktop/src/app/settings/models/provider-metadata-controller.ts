import type { ModelProviderGroup } from "@llm-space/core";

export type ProviderMetadataApi = NonNullable<ModelProviderGroup["api"]>;
export type ProviderMetadataTextField = "name" | "icon";
export type ProviderMetadataField = ProviderMetadataTextField | "api";

export interface ProviderMetadataTarget {
  readonly providerId: string;
  readonly name: string;
  readonly api: ProviderMetadataApi;
  readonly icon: string;
}

export interface ProviderMetadataSnapshot extends ProviderMetadataTarget {}

export interface ProviderMetadataControllerOptions {
  readonly updateProvider: (
    providerId: string,
    fields: {
      readonly name?: string;
      readonly api?: ProviderMetadataApi;
      readonly icon?: string | null;
    }
  ) => Promise<void>;
  readonly saveFailed: (
    field: ProviderMetadataField,
    error: unknown
  ) => void;
}

interface FieldIntent {
  readonly epoch: number;
  readonly field: ProviderMetadataField;
  readonly generation: number;
  readonly providerId: string;
  readonly displayValue: string;
  readonly patch: Parameters<
    ProviderMetadataControllerOptions["updateProvider"]
  >[1];
}

type Listener = () => void;

const EMPTY_SNAPSHOT: ProviderMetadataSnapshot = {
  providerId: "",
  name: "",
  api: "openai-completions",
  icon: "",
};

/**
 * Owns one provider editor's metadata Drafts and ordered persistence.
 *
 * Each field rolls back to its last successful/authoritative value only when
 * the failing intent is still latest. Retargeting invalidates queued work and
 * every result from the previous provider.
 */
export class ProviderMetadataController {
  private readonly _listeners = new Set<Listener>();
  private readonly _dirty = new Set<ProviderMetadataTextField>();
  private readonly _latestGeneration = new Map<ProviderMetadataField, number>();
  private readonly _pendingCount = new Map<ProviderMetadataField, number>();
  private _authoritative: ProviderMetadataSnapshot = EMPTY_SNAPSHOT;
  private _epoch = 0;
  private _nextGeneration = 0;
  private _snapshot: ProviderMetadataSnapshot = EMPTY_SNAPSHOT;
  private _tail = Promise.resolve();

  constructor(
    target: ProviderMetadataTarget | null,
    private readonly _options: ProviderMetadataControllerOptions
  ) {
    if (target) {
      this._authoritative = { ...target };
      this._snapshot = { ...target };
    }
  }

  readonly getSnapshot = (): ProviderMetadataSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Apply a new authoritative catalog projection without erasing live Drafts. */
  sync(target: ProviderMetadataTarget | null): void {
    if (target === null) {
      this.close();
      return;
    }
    if (target.providerId !== this._snapshot.providerId) {
      this._retarget(target);
      return;
    }

    this._authoritative = { ...target };
    let next = this._snapshot;
    for (const field of ["name", "api", "icon"] as const) {
      if (!this._hasPending(field) && !this._isDirty(field)) {
        next = { ...next, [field]: target[field] };
      }
    }
    this._setSnapshot(next);
  }

  /** Invalidate every queued/in-flight result owned by this editor. */
  close(): void {
    if (this._snapshot.providerId === "") return;
    this._epoch += 1;
    this._tail = Promise.resolve();
    this._dirty.clear();
    this._latestGeneration.clear();
    this._pendingCount.clear();
    this._authoritative = EMPTY_SNAPSHOT;
    this._setSnapshot(EMPTY_SNAPSHOT);
  }

  /** Update a local text Draft without starting persistence. */
  draft(field: ProviderMetadataTextField, value: string): void {
    if (this._snapshot.providerId === "") return;
    this._dirty.add(field);
    this._setSnapshot({ ...this._snapshot, [field]: value });
  }

  /** Normalize and persist the current name or icon Draft. */
  commit(field: ProviderMetadataTextField): void {
    if (this._snapshot.providerId === "" || !this._dirty.has(field)) return;
    const trimmed = this._snapshot[field].trim();
    if (field === "name" && trimmed === "") {
      this._dirty.delete(field);
      this._setSnapshot({
        ...this._snapshot,
        name: this._authoritative.name,
      });
      return;
    }

    const displayValue = trimmed;
    this._dirty.delete(field);
    this._setSnapshot({ ...this._snapshot, [field]: displayValue });
    if (
      !this._hasPending(field) &&
      displayValue === this._authoritative[field]
    ) {
      return;
    }

    this._enqueue({
      field,
      displayValue,
      patch:
        field === "name"
          ? { name: displayValue }
          : { icon: displayValue === "" ? null : displayValue },
    });
  }

  /** Optimistically select and persist a custom provider API mode. */
  selectApi(api: ProviderMetadataApi): void {
    if (this._snapshot.providerId === "" || api === this._snapshot.api) return;
    this._setSnapshot({ ...this._snapshot, api });
    this._enqueue({ field: "api", displayValue: api, patch: { api } });
  }

  private _retarget(target: ProviderMetadataTarget): void {
    this._epoch += 1;
    this._tail = Promise.resolve();
    this._dirty.clear();
    this._latestGeneration.clear();
    this._pendingCount.clear();
    this._authoritative = { ...target };
    this._setSnapshot({ ...target });
  }

  private _enqueue(
    intent: Pick<FieldIntent, "field" | "displayValue" | "patch">
  ): void {
    const operation: FieldIntent = {
      ...intent,
      epoch: this._epoch,
      generation: ++this._nextGeneration,
      providerId: this._snapshot.providerId,
    };
    this._latestGeneration.set(operation.field, operation.generation);
    this._pendingCount.set(
      operation.field,
      (this._pendingCount.get(operation.field) ?? 0) + 1
    );

    const previous = this._tail;
    const pending = previous.then(async () => {
      if (!this._isCurrentTarget(operation)) return;
      await this._options.updateProvider(operation.providerId, operation.patch);
    });
    this._tail = pending.then(
      () => undefined,
      () => undefined
    );
    void pending.then(
      () => this._settleSuccess(operation),
      (error) => this._settleFailure(operation, error)
    );
  }

  private _settleSuccess(intent: FieldIntent): void {
    if (!this._isCurrentTarget(intent)) return;
    this._decrementPending(intent.field);
    this._authoritative = {
      ...this._authoritative,
      [intent.field]: intent.displayValue,
    };
    if (this._shouldProjectSettlement(intent)) {
      this._setSnapshot({
        ...this._snapshot,
        [intent.field]: intent.displayValue,
      });
    }
  }

  private _settleFailure(intent: FieldIntent, error: unknown): void {
    if (!this._isCurrentTarget(intent)) return;
    this._decrementPending(intent.field);
    if (this._latestGeneration.get(intent.field) !== intent.generation) return;
    if (!this._isDirty(intent.field)) {
      this._setSnapshot({
        ...this._snapshot,
        [intent.field]: this._authoritative[intent.field],
      });
    }
    this._options.saveFailed(intent.field, error);
  }

  private _shouldProjectSettlement(intent: FieldIntent): boolean {
    return (
      this._latestGeneration.get(intent.field) === intent.generation &&
      !this._isDirty(intent.field)
    );
  }

  private _isCurrentTarget(intent: FieldIntent): boolean {
    return (
      this._epoch === intent.epoch &&
      this._snapshot.providerId === intent.providerId
    );
  }

  private _hasPending(field: ProviderMetadataField): boolean {
    return (this._pendingCount.get(field) ?? 0) > 0;
  }

  private _isDirty(field: ProviderMetadataField): boolean {
    return field !== "api" && this._dirty.has(field);
  }

  private _decrementPending(field: ProviderMetadataField): void {
    const count = this._pendingCount.get(field) ?? 0;
    if (count <= 1) this._pendingCount.delete(field);
    else this._pendingCount.set(field, count - 1);
  }

  private _setSnapshot(snapshot: ProviderMetadataSnapshot): void {
    if (
      snapshot.providerId === this._snapshot.providerId &&
      snapshot.name === this._snapshot.name &&
      snapshot.api === this._snapshot.api &&
      snapshot.icon === this._snapshot.icon
    ) {
      return;
    }
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
