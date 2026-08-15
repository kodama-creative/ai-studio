import type { ModelProviderGroup } from "@llm-space/core";

export type AddProviderChoice =
  | {
      readonly type: "builtin";
      readonly provider: ModelProviderGroup;
    }
  | { readonly type: "custom" };

export interface AddProviderSnapshot {
  readonly open: boolean;
  readonly builtinProviders: readonly ModelProviderGroup[] | null;
  readonly discoveryFailed: boolean;
  readonly addingProviderId: string | null;
}

export interface AddProviderControllerOptions {
  readonly fetchBuiltinProviders: () => Promise<ModelProviderGroup[]>;
  readonly addBuiltinProvider: (providerId: string) => Promise<void>;
  readonly addCustomProvider: () => Promise<string>;
  readonly providerAdded: (providerId: string) => void;
  readonly addFailed: (providerName: string, error: unknown) => void;
}

type Listener = () => void;

const CLOSED_SNAPSHOT: AddProviderSnapshot = {
  open: false,
  builtinProviders: null,
  discoveryFailed: false,
  addingProviderId: null,
};

/**
 * Owns provider discovery and mutation for the Add Provider popover.
 *
 * Each open is a new presentation session. Discovery and mutation results only
 * affect the session that started them, while an underlying mutation remains
 * globally exclusive until it settles so close/reopen cannot submit twice.
 */
export class AddProviderController {
  private readonly _listeners = new Set<Listener>();
  private _session = 0;
  private _discoveryRequest = 0;
  private _mutationRequest = 0;
  private _mutationPending = false;
  private _snapshot: AddProviderSnapshot = CLOSED_SNAPSHOT;

  constructor(private readonly _options: AddProviderControllerOptions) {}

  readonly getSnapshot = (): AddProviderSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Open a fresh discovery session or invalidate the currently visible one. */
  readonly setOpen = (open: boolean): void => {
    if (this._snapshot.open === open) return;
    this._session += 1;
    this._discoveryRequest += 1;
    this._setSnapshot({
      open,
      builtinProviders: null,
      discoveryFailed: false,
      addingProviderId: this._mutationPending
        ? this._snapshot.addingProviderId
        : null,
    });
    if (open) void this._discoverProviders();
  };

  /** Apply at most one provider choice while its originating session is open. */
  readonly choose = async (choice: AddProviderChoice): Promise<void> => {
    if (!this._snapshot.open || this._mutationPending) return;

    const session = this._session;
    const request = ++this._mutationRequest;
    const providerId = choice.type === "builtin" ? choice.provider.id : "custom";
    const providerName =
      choice.type === "builtin" ? choice.provider.name : "custom provider";
    this._mutationPending = true;
    this._setSnapshot({ ...this._snapshot, addingProviderId: providerId });

    try {
      const addedProviderId =
        choice.type === "builtin"
          ? await this._addBuiltin(choice.provider.id)
          : await this._options.addCustomProvider();
      this._mutationPending = false;
      if (!this._isCurrentMutation(session, request)) {
        this._clearStaleMutation(providerId);
        return;
      }
      this._setSnapshot({ ...CLOSED_SNAPSHOT });
      this._options.providerAdded(addedProviderId);
    } catch (error) {
      this._mutationPending = false;
      if (!this._isCurrentMutation(session, request)) {
        this._clearStaleMutation(providerId);
        return;
      }
      this._setSnapshot({ ...this._snapshot, addingProviderId: null });
      this._options.addFailed(providerName, error);
    }
  };

  private async _addBuiltin(providerId: string): Promise<string> {
    await this._options.addBuiltinProvider(providerId);
    return providerId;
  }

  private async _discoverProviders(): Promise<void> {
    const session = this._session;
    const request = ++this._discoveryRequest;
    try {
      const builtinProviders = await this._options.fetchBuiltinProviders();
      if (!this._isCurrentDiscovery(session, request)) return;
      this._setSnapshot({
        ...this._snapshot,
        builtinProviders,
        discoveryFailed: false,
      });
    } catch {
      if (!this._isCurrentDiscovery(session, request)) return;
      this._setSnapshot({
        ...this._snapshot,
        builtinProviders: [],
        discoveryFailed: true,
      });
    }
  }

  private _isCurrentDiscovery(session: number, request: number): boolean {
    return (
      this._snapshot.open &&
      this._session === session &&
      this._discoveryRequest === request
    );
  }

  private _isCurrentMutation(session: number, request: number): boolean {
    return (
      this._snapshot.open &&
      this._session === session &&
      this._mutationRequest === request
    );
  }

  private _clearStaleMutation(providerId: string): void {
    if (this._snapshot.addingProviderId !== providerId) return;
    this._setSnapshot({ ...this._snapshot, addingProviderId: null });
  }

  private _setSnapshot(snapshot: AddProviderSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
