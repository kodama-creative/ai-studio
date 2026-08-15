type Listener = () => void;

export interface SettingsFormSnapshot<TSettings, TContext> {
  readonly settings: TSettings;
  readonly context: TContext;
  readonly loading: boolean;
}

export interface SettingsFormControllerOptions<TSettings, TContext> {
  readonly initialSettings: TSettings;
  readonly initialContext: TContext;
  readonly loadSettings: () => Promise<TSettings>;
  readonly saveSettings: (settings: TSettings) => Promise<TSettings>;
  readonly loadContext?: () => Promise<TContext>;
  readonly notifySaveError: (error: unknown) => void;
}

/**
 * Owns one RPC-backed settings form, including restartable reads, ordered
 * writes, local Drafts, and optimistic rollback to the latest committed value.
 */
export class SettingsFormController<TSettings, TContext = undefined> {
  private readonly _listeners = new Set<Listener>();
  private _committedSettings: TSettings;
  private _contextRequest = 0;
  private _lifecycle = 0;
  private _mutationTail = Promise.resolve();
  private _revision = 0;
  private _settingsRequest = 0;
  private _snapshot: SettingsFormSnapshot<TSettings, TContext>;
  private _started = false;

  constructor(
    private readonly _options: SettingsFormControllerOptions<
      TSettings,
      TContext
    >
  ) {
    this._committedSettings = _options.initialSettings;
    this._snapshot = {
      settings: _options.initialSettings,
      context: _options.initialContext,
      loading: true,
    };
  }

  readonly getSnapshot = (): SettingsFormSnapshot<TSettings, TContext> =>
    this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.stop();
    this._started = true;
    this._lifecycle += 1;
    this._set({ ...this._snapshot, loading: true });
    void this._loadSettings();
    void this._loadContext();
  }

  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    this._settingsRequest += 1;
    this._contextRequest += 1;
  }

  update(settings: TSettings): void {
    this._requireStarted();
    this._revision += 1;
    this._set({ ...this._snapshot, settings });
  }

  /** Optimistically replace and persist, rolling back a failed latest intent. */
  commit(settings: TSettings): Promise<void> {
    this.update(settings);
    return this._save(settings, this._revision, true);
  }

  /** Persist the current Draft; a failure keeps it available for correction. */
  save(): Promise<void> {
    this._requireStarted();
    return this._save(this._snapshot.settings, this._revision, false);
  }

  private async _loadSettings(): Promise<void> {
    const lifecycle = this._lifecycle;
    await this._mutationTail.catch(() => undefined);
    if (!this._isCurrent(lifecycle)) return;
    const request = ++this._settingsRequest;
    const revision = this._revision;
    try {
      const settings = await this._options.loadSettings();
      if (!this._isCurrent(lifecycle) || request !== this._settingsRequest)
        return;
      this._committedSettings = settings;
      this._set({
        ...this._snapshot,
        settings:
          revision === this._revision ? settings : this._snapshot.settings,
        loading: false,
      });
    } catch {
      if (this._isCurrent(lifecycle) && request === this._settingsRequest) {
        this._set({ ...this._snapshot, loading: false });
      }
    }
  }

  private async _loadContext(): Promise<void> {
    if (this._options.loadContext === undefined) return;
    const lifecycle = this._lifecycle;
    const request = ++this._contextRequest;
    try {
      const context = await this._options.loadContext();
      if (
        this._isCurrent(lifecycle) &&
        request === this._contextRequest
      ) {
        this._set({ ...this._snapshot, context });
      }
    } catch {
      // Auxiliary context is best-effort and never blocks form editing.
    }
  }

  private _save(
    settings: TSettings,
    revision: number,
    rollbackLatest: boolean
  ): Promise<void> {
    const lifecycle = this._lifecycle;
    return this._enqueueMutation(async () => {
      if (!this._isCurrent(lifecycle)) return;
      this._settingsRequest += 1;
      try {
        const saved = await this._options.saveSettings(settings);
        if (!this._isCurrent(lifecycle)) return;
        this._committedSettings = saved;
        if (revision === this._revision) {
          this._set({ ...this._snapshot, settings: saved, loading: false });
        }
      } catch (error) {
        if (!this._isCurrent(lifecycle)) return;
        if (rollbackLatest && revision === this._revision) {
          this._revision += 1;
          this._set({
            ...this._snapshot,
            settings: this._committedSettings,
            loading: false,
          });
        }
        this._options.notifySaveError(error);
      }
    });
  }

  private _enqueueMutation(run: () => Promise<void>): Promise<void> {
    const task = this._mutationTail.catch(() => undefined).then(run);
    this._mutationTail = task.catch(() => undefined);
    return task;
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _set(snapshot: SettingsFormSnapshot<TSettings, TContext>): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("SettingsFormController must be started first.");
    }
  }
}
