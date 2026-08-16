import type {
  ProviderProfile,
  ProviderProfilePatch,
} from "@llm-space/core";

export type ProviderProfileField =
  | "name"
  | "apiKey"
  | "baseUrl"
  | "headers";
export type ProviderProfileTextField = Exclude<
  ProviderProfileField,
  "headers"
>;

export interface ProviderHeaderRow {
  readonly id: string;
  readonly key: string;
  readonly value: string;
}

export interface ProviderProfileTarget {
  readonly providerId: string;
  readonly profile: ProviderProfile;
}

export interface ProviderProfileSnapshot {
  readonly providerId: string;
  readonly profileId: string;
  readonly name: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly baseUrlEnabled: boolean;
  readonly headers: readonly ProviderHeaderRow[];
}

export interface ProviderProfileControllerOptions {
  readonly updateProfile: (
    providerId: string,
    profileId: string,
    patch: ProviderProfilePatch
  ) => Promise<void>;
  readonly saveFailed: (field: ProviderProfileField, error: unknown) => void;
}

interface AuthoritativeProfile {
  readonly name: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface ProfileIntent {
  readonly epoch: number;
  readonly field: ProviderProfileField;
  readonly generation: number;
  readonly providerId: string;
  readonly profileId: string;
  readonly displayValue: string | Readonly<Record<string, string>>;
  readonly patch: ProviderProfilePatch;
}

type Listener = () => void;

const EMPTY_AUTHORITATIVE: AuthoritativeProfile = {
  name: "",
  apiKey: "",
  baseUrl: "",
  headers: {},
};

const EMPTY_SNAPSHOT: ProviderProfileSnapshot = {
  providerId: "",
  profileId: "",
  name: "",
  apiKey: "",
  baseUrl: "",
  baseUrlEnabled: false,
  headers: [],
};

/**
 * Owns one connection profile's Drafts and ordered persistence.
 *
 * Scalar failures roll back only the latest intent to the last successful or
 * authoritative value. Header failures retain the latest Draft for retry.
 * Retargeting invalidates queued work and all prior results.
 */
export class ProviderProfileController {
  private readonly _listeners = new Set<Listener>();
  private readonly _dirty = new Set<ProviderProfileTextField>();
  private readonly _latestGeneration = new Map<ProviderProfileField, number>();
  private readonly _pendingCount = new Map<ProviderProfileField, number>();
  private _authoritative: AuthoritativeProfile = EMPTY_AUTHORITATIVE;
  private _baseUrlToggleLocal = false;
  private _epoch = 0;
  private _headersDirty = false;
  private _nextGeneration = 0;
  private _nextRowId = 0;
  private _snapshot: ProviderProfileSnapshot = EMPTY_SNAPSHOT;
  private _tail = Promise.resolve();

  constructor(
    target: ProviderProfileTarget | null,
    private readonly _options: ProviderProfileControllerOptions
  ) {
    if (target) this._retarget(target);
  }

  readonly getSnapshot = (): ProviderProfileSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Apply a catalog projection without erasing live or failed Drafts. */
  sync(target: ProviderProfileTarget | null): void {
    if (target === null) {
      this.close();
      return;
    }
    if (
      target.providerId !== this._snapshot.providerId ||
      target.profile.id !== this._snapshot.profileId
    ) {
      this._retarget(target);
      return;
    }

    const nextAuthoritative = _authoritative(target.profile);
    const headersChanged = !_sameHeaders(
      this._authoritative.headers,
      nextAuthoritative.headers
    );
    this._authoritative = nextAuthoritative;
    let next = this._snapshot;
    for (const field of ["name", "apiKey", "baseUrl"] as const) {
      if (!this._hasPending(field) && !this._dirty.has(field)) {
        next = { ...next, [field]: nextAuthoritative[field] };
      }
    }
    if (
      !this._hasPending("baseUrl") &&
      !this._dirty.has("baseUrl") &&
      !this._baseUrlToggleLocal
    ) {
      next = {
        ...next,
        baseUrlEnabled: nextAuthoritative.baseUrl.length > 0,
      };
    }
    if (
      headersChanged &&
      !this._hasPending("headers") &&
      !this._headersDirty
    ) {
      next = { ...next, headers: this._rows(nextAuthoritative.headers) };
    }
    this._setSnapshot(next);
  }

  /** Invalidate every queued/in-flight result owned by this editor. */
  close(): void {
    if (this._snapshot.profileId === "") return;
    this._epoch += 1;
    this._tail = Promise.resolve();
    this._dirty.clear();
    this._latestGeneration.clear();
    this._pendingCount.clear();
    this._headersDirty = false;
    this._baseUrlToggleLocal = false;
    this._authoritative = EMPTY_AUTHORITATIVE;
    this._setSnapshot(EMPTY_SNAPSHOT);
  }

  /** Update a scalar Draft without starting persistence. */
  draft(field: ProviderProfileTextField, value: string): void {
    if (this._snapshot.profileId === "") return;
    this._dirty.add(field);
    this._setSnapshot({ ...this._snapshot, [field]: value });
  }

  /** Normalize and persist the current scalar Draft. */
  commit(field: ProviderProfileTextField): void {
    if (this._snapshot.profileId === "" || !this._dirty.has(field)) return;
    const displayValue = this._snapshot[field].trim();
    this._dirty.delete(field);
    if (field === "name" && displayValue === "") {
      this._setSnapshot({
        ...this._snapshot,
        name: this._authoritative.name,
      });
      return;
    }

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
      patch: {
        [field]:
          field === "name" || displayValue !== "" ? displayValue : null,
      },
    });
  }

  /** Toggle the builtin-provider custom endpoint and persist Disable as clear. */
  setBaseUrlEnabled(enabled: boolean): void {
    if (
      this._snapshot.profileId === "" ||
      enabled === this._snapshot.baseUrlEnabled
    ) {
      return;
    }
    if (enabled) {
      this._baseUrlToggleLocal = true;
      this._setSnapshot({ ...this._snapshot, baseUrlEnabled: true });
      return;
    }

    this._baseUrlToggleLocal = false;
    this._dirty.delete("baseUrl");
    this._setSnapshot({
      ...this._snapshot,
      baseUrl: "",
      baseUrlEnabled: false,
    });
    if (!this._hasPending("baseUrl") && this._authoritative.baseUrl === "") {
      return;
    }
    this._enqueue({
      field: "baseUrl",
      displayValue: "",
      patch: { baseUrl: null },
    });
  }

  addHeader(): void {
    if (this._snapshot.profileId === "") return;
    this._headersDirty = true;
    this._setSnapshot({
      ...this._snapshot,
      headers: [...this._snapshot.headers, this._row("", "")],
    });
  }

  editHeader(
    rowId: string,
    field: "key" | "value",
    value: string
  ): void {
    if (this._snapshot.profileId === "") return;
    const headers = this._snapshot.headers.map((row) =>
      row.id === rowId ? { ...row, [field]: value } : row
    );
    if (headers.every((row, index) => row === this._snapshot.headers[index])) {
      return;
    }
    this._headersDirty = true;
    this._setSnapshot({ ...this._snapshot, headers });
  }

  removeHeader(rowId: string): void {
    if (this._snapshot.profileId === "") return;
    const headers = this._snapshot.headers.filter((row) => row.id !== rowId);
    if (headers.length === this._snapshot.headers.length) return;
    this._headersDirty = true;
    this._setSnapshot({ ...this._snapshot, headers });
    this._commitHeaders(headers);
  }

  commitHeaders(): void {
    this._commitHeaders(this._snapshot.headers);
  }

  private _commitHeaders(rows: readonly ProviderHeaderRow[]): void {
    if (this._snapshot.profileId === "" || !this._headersDirty) return;
    const headers = _headersFromRows(rows);
    this._headersDirty = false;
    if (
      !this._hasPending("headers") &&
      _sameHeaders(headers, this._authoritative.headers)
    ) {
      return;
    }
    this._enqueue({
      field: "headers",
      displayValue: headers,
      patch: { headers: Object.keys(headers).length > 0 ? headers : null },
    });
  }

  private _retarget(target: ProviderProfileTarget): void {
    this._epoch += 1;
    this._tail = Promise.resolve();
    this._dirty.clear();
    this._latestGeneration.clear();
    this._pendingCount.clear();
    this._headersDirty = false;
    this._baseUrlToggleLocal = false;
    this._authoritative = _authoritative(target.profile);
    this._setSnapshot({
      providerId: target.providerId,
      profileId: target.profile.id,
      name: this._authoritative.name,
      apiKey: this._authoritative.apiKey,
      baseUrl: this._authoritative.baseUrl,
      baseUrlEnabled: this._authoritative.baseUrl.length > 0,
      headers: this._rows(this._authoritative.headers),
    });
  }

  private _enqueue(
    intent: Pick<ProfileIntent, "field" | "displayValue" | "patch">
  ): void {
    const operation: ProfileIntent = {
      ...intent,
      epoch: this._epoch,
      generation: ++this._nextGeneration,
      providerId: this._snapshot.providerId,
      profileId: this._snapshot.profileId,
    };
    this._latestGeneration.set(operation.field, operation.generation);
    this._pendingCount.set(
      operation.field,
      (this._pendingCount.get(operation.field) ?? 0) + 1
    );

    const previous = this._tail;
    const pending = previous.then(async () => {
      if (!this._isCurrentTarget(operation)) return;
      await this._options.updateProfile(
        operation.providerId,
        operation.profileId,
        operation.patch
      );
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

  private _settleSuccess(intent: ProfileIntent): void {
    if (!this._isCurrentTarget(intent)) return;
    this._decrementPending(intent.field);
    if (intent.field === "headers") {
      this._authoritative = {
        ...this._authoritative,
        headers: intent.displayValue as Readonly<Record<string, string>>,
      };
      return;
    }
    this._authoritative = {
      ...this._authoritative,
      [intent.field]: intent.displayValue as string,
    };
    if (intent.field === "baseUrl" && intent.displayValue !== "") {
      this._baseUrlToggleLocal = false;
    }
    if (
      this._latestGeneration.get(intent.field) === intent.generation &&
      !this._dirty.has(intent.field)
    ) {
      this._setSnapshot({
        ...this._snapshot,
        [intent.field]: intent.displayValue,
      });
    }
  }

  private _settleFailure(intent: ProfileIntent, error: unknown): void {
    if (!this._isCurrentTarget(intent)) return;
    this._decrementPending(intent.field);
    if (this._latestGeneration.get(intent.field) !== intent.generation) return;
    if (intent.field === "headers") {
      this._headersDirty = true;
    } else if (!this._dirty.has(intent.field)) {
      const baseUrlEnabled =
        intent.field === "baseUrl" && !this._snapshot.baseUrlEnabled
          ? this._authoritative.baseUrl.length > 0
          : this._snapshot.baseUrlEnabled;
      if (intent.field === "baseUrl" && !this._snapshot.baseUrlEnabled) {
        this._baseUrlToggleLocal = false;
      }
      this._setSnapshot({
        ...this._snapshot,
        [intent.field]: this._authoritative[intent.field],
        baseUrlEnabled,
      });
    }
    this._options.saveFailed(intent.field, error);
  }

  private _rows(
    headers: Readonly<Record<string, string>>
  ): readonly ProviderHeaderRow[] {
    return Object.entries(headers).map(([key, value]) => this._row(key, value));
  }

  private _row(key: string, value: string): ProviderHeaderRow {
    return { id: `header-${++this._nextRowId}`, key, value };
  }

  private _isCurrentTarget(intent: ProfileIntent): boolean {
    return (
      this._epoch === intent.epoch &&
      this._snapshot.providerId === intent.providerId &&
      this._snapshot.profileId === intent.profileId
    );
  }

  private _hasPending(field: ProviderProfileField): boolean {
    return (this._pendingCount.get(field) ?? 0) > 0;
  }

  private _decrementPending(field: ProviderProfileField): void {
    const count = this._pendingCount.get(field) ?? 0;
    if (count <= 1) this._pendingCount.delete(field);
    else this._pendingCount.set(field, count - 1);
  }

  private _setSnapshot(snapshot: ProviderProfileSnapshot): void {
    if (_sameSnapshot(snapshot, this._snapshot)) return;
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}

function _authoritative(profile: ProviderProfile): AuthoritativeProfile {
  return {
    name: profile.name,
    apiKey: profile.apiKey ?? "",
    baseUrl: profile.baseUrl ?? "",
    headers: { ...(profile.headers ?? {}) },
  };
}

function _headersFromRows(
  rows: readonly ProviderHeaderRow[]
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key !== "") headers[key] = row.value;
  }
  return headers;
}

function _sameHeaders(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function _sameSnapshot(
  left: ProviderProfileSnapshot,
  right: ProviderProfileSnapshot
): boolean {
  return (
    left.providerId === right.providerId &&
    left.profileId === right.profileId &&
    left.name === right.name &&
    left.apiKey === right.apiKey &&
    left.baseUrl === right.baseUrl &&
    left.baseUrlEnabled === right.baseUrlEnabled &&
    left.headers === right.headers
  );
}
