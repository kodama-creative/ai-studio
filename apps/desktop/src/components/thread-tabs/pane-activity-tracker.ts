export type PaneRunStart = (paneId: string, runId: string) => boolean;
export type PaneRunSettled = (paneId: string, runId: string) => void;
export type PanePersistenceChange = (
  paneId: string,
  owner: object,
  busy: boolean
) => void;

/** Coordinates tab mutations with in-flight execution and persistence. */
export class PaneActivityTracker {
  private readonly _mutatingPanes = new Set<string>();
  private readonly _persistingPanes = new Map<string, Set<object>>();
  private readonly _runningPanes = new Map<string, Set<string>>();
  private readonly _listeners = new Set<() => void>();
  private _version = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this._version;

  beginRun(paneId: string, runId: string): boolean {
    if (this.isMutationReserved(paneId)) return false;
    let runs = this._runningPanes.get(paneId);
    if (!runs) {
      runs = new Set();
      this._runningPanes.set(paneId, runs);
    }
    runs.add(runId);
    return true;
  }

  settleRun(paneId: string, runId: string): boolean {
    const runs = this._runningPanes.get(paneId);
    if (!runs?.delete(runId)) return false;
    if (runs.size === 0) this._runningPanes.delete(paneId);
    return true;
  }

  setPersistenceBusy(
    paneId: string,
    owner: object,
    busy: boolean
  ): void {
    if (busy) {
      let owners = this._persistingPanes.get(paneId);
      if (!owners) {
        owners = new Set();
        this._persistingPanes.set(paneId, owners);
      }
      owners.add(owner);
      return;
    }
    const owners = this._persistingPanes.get(paneId);
    owners?.delete(owner);
    if (owners?.size === 0) this._persistingPanes.delete(paneId);
  }

  isPaneBusy(paneId: string): boolean {
    return (
      (this._runningPanes.get(paneId)?.size ?? 0) > 0 ||
      (this._persistingPanes.get(paneId)?.size ?? 0) > 0
    );
  }

  isMutationReserved(paneId: string): boolean {
    return this._mutatingPanes.has(paneId);
  }

  reservePanes(paneIds: Iterable<string>): (() => void) | null {
    const ids = [...new Set(paneIds)];
    if (
      ids.some(
        (paneId) =>
          this.isPaneBusy(paneId) || this._mutatingPanes.has(paneId)
      )
    ) {
      return null;
    }
    ids.forEach((paneId) => this._mutatingPanes.add(paneId));
    this._notifyMutationChange();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      ids.forEach((paneId) => this._mutatingPanes.delete(paneId));
      this._notifyMutationChange();
    };
  }

  private _notifyMutationChange(): void {
    this._version += 1;
    this._listeners.forEach((listener) => listener());
  }
}
