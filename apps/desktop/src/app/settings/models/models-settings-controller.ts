import type {
  ModelProviderGroup,
  ProviderProfilePatch,
} from "@llm-space/core";

import {
  AddProviderController,
  type AddProviderControllerOptions,
} from "./add-provider-controller";
import {
  ProviderMetadataController,
  type ProviderMetadataControllerOptions,
  type ProviderMetadataField,
  type ProviderMetadataTarget,
} from "./provider-metadata-controller";
import {
  ProviderProfileController,
  type ProviderProfileField,
  type ProviderProfileTarget,
} from "./provider-profile-controller";
import {
  ProviderProfilesController,
  type ProviderProfilesControllerOptions,
  type ProviderProfilesOperation,
  type ProviderProfilesTarget,
} from "./provider-profiles-controller";

export type ModelsSettingsFailure =
  | {
      readonly operation: "add-provider";
      readonly providerName: string;
    }
  | {
      readonly operation: "remove-provider";
      readonly providerId: string;
    }
  | {
      readonly operation: "save-provider-metadata";
      readonly field: ProviderMetadataField;
    }
  | {
      readonly operation: "mutate-provider-profiles";
      readonly mutation: ProviderProfilesOperation;
    }
  | {
      readonly operation: "save-provider-profile";
      readonly field: ProviderProfileField;
    };

export interface ModelsSettingsControllerOptions {
  readonly fetchBuiltinProviders: AddProviderControllerOptions["fetchBuiltinProviders"];
  readonly addBuiltinProvider: AddProviderControllerOptions["addBuiltinProvider"];
  readonly addCustomProvider: AddProviderControllerOptions["addCustomProvider"];
  readonly removeProvider: (providerId: string) => Promise<void>;
  readonly updateProvider: ProviderMetadataControllerOptions["updateProvider"];
  readonly addProviderProfile: ProviderProfilesControllerOptions["addProfile"];
  readonly removeProviderProfile: ProviderProfilesControllerOptions["removeProfile"];
  readonly updateProviderProfile: (
    providerId: string,
    profileId: string,
    patch: ProviderProfilePatch
  ) => Promise<void>;
  readonly mutationFailed: (
    failure: ModelsSettingsFailure,
    error: unknown
  ) => void;
}

export interface ModelsSettingsSnapshot {
  readonly providers: readonly ModelProviderGroup[];
  readonly selectedProviderId: string | null;
  readonly removalCandidateId: string | null;
  readonly removingProviderId: string | null;
}

interface RemovalLease {
  readonly epoch: number;
  readonly providerId: string;
}

type Listener = () => void;

const EMPTY_SNAPSHOT: ModelsSettingsSnapshot = {
  providers: [],
  selectedProviderId: null,
  removalCandidateId: null,
  removingProviderId: null,
};

/**
 * Application module for the complete Models Settings workflow.
 *
 * The shared ModelCatalogController remains the catalog and mutation authority.
 * This aggregate owns settings-local selection, removal admission and the
 * lifecycle of the focused provider/profile editors projected from that
 * catalog. It has no React, Electrobun or toast dependency.
 */
export class ModelsSettingsController {
  readonly addProvider: AddProviderController;
  readonly metadata: ProviderMetadataController;
  readonly profiles: ProviderProfilesController;
  readonly profile: ProviderProfileController;

  private readonly _listeners = new Set<Listener>();
  private readonly _unsubscribeProfiles: () => void;
  private _closed = false;
  private _epoch = 0;
  private _pendingSelectionId: string | null = null;
  private _snapshot: ModelsSettingsSnapshot = EMPTY_SNAPSHOT;

  constructor(
    providers: readonly ModelProviderGroup[],
    private readonly _options: ModelsSettingsControllerOptions
  ) {
    this.addProvider = new AddProviderController({
      fetchBuiltinProviders: _options.fetchBuiltinProviders,
      addBuiltinProvider: _options.addBuiltinProvider,
      addCustomProvider: _options.addCustomProvider,
      providerAdded: (providerId) => this._providerAdded(providerId),
      addFailed: (providerName, error) =>
        _options.mutationFailed(
          { operation: "add-provider", providerName },
          error
        ),
    });
    this.metadata = new ProviderMetadataController(null, {
      updateProvider: _options.updateProvider,
      saveFailed: (field, error) =>
        _options.mutationFailed(
          { operation: "save-provider-metadata", field },
          error
        ),
    });
    this.profiles = new ProviderProfilesController(null, {
      addProfile: _options.addProviderProfile,
      removeProfile: _options.removeProviderProfile,
      mutationFailed: (mutation, error) =>
        _options.mutationFailed(
          { operation: "mutate-provider-profiles", mutation },
          error
        ),
    });
    this.profile = new ProviderProfileController(null, {
      updateProfile: _options.updateProviderProfile,
      saveFailed: (field, error) =>
        _options.mutationFailed(
          { operation: "save-provider-profile", field },
          error
        ),
    });
    this._unsubscribeProfiles = this.profiles.subscribe(() => {
      this._syncSelectedProfile();
    });
    this.syncCatalog(providers);
  }

  readonly getSnapshot = (): ModelsSettingsSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getSelectedProvider(): ModelProviderGroup | null {
    return (
      this._snapshot.providers.find(
        (provider) => provider.id === this._snapshot.selectedProviderId
      ) ?? null
    );
  }

  /** Synchronize the authoritative ModelCatalogController projection. */
  syncCatalog(providers: readonly ModelProviderGroup[]): void {
    if (this._closed) return;
    const providerIds = new Set(providers.map((provider) => provider.id));
    const removalTargetDisappeared =
      this._snapshot.removingProviderId !== null &&
      !providerIds.has(this._snapshot.removingProviderId);
    if (removalTargetDisappeared) this._epoch += 1;
    let selectedProviderId = this._snapshot.selectedProviderId;
    if (
      this._pendingSelectionId !== null &&
      providerIds.has(this._pendingSelectionId)
    ) {
      selectedProviderId = this._pendingSelectionId;
      this._pendingSelectionId = null;
    } else if (
      selectedProviderId === null ||
      !providerIds.has(selectedProviderId)
    ) {
      selectedProviderId = _firstProviderId(providers);
    }
    const removalCandidateId =
      this._snapshot.removalCandidateId !== null &&
      providerIds.has(this._snapshot.removalCandidateId)
        ? this._snapshot.removalCandidateId
        : null;
    this._setSnapshot({
      providers: [...providers],
      selectedProviderId,
      removalCandidateId,
      removingProviderId: removalTargetDisappeared
        ? null
        : this._snapshot.removingProviderId,
    });
    this._syncFocusedControllers();
  }

  selectProvider(providerId: string): void {
    if (
      this._closed ||
      providerId === this._snapshot.selectedProviderId ||
      !this._snapshot.providers.some((provider) => provider.id === providerId)
    ) {
      return;
    }
    this._pendingSelectionId = null;
    this._setSnapshot({
      ...this._snapshot,
      selectedProviderId: providerId,
    });
    this._syncFocusedControllers();
  }

  requestRemoveProvider(providerId: string): void {
    if (
      this._closed ||
      this._snapshot.removingProviderId !== null ||
      !this._snapshot.providers.some((provider) => provider.id === providerId)
    ) {
      return;
    }
    this._setSnapshot({
      ...this._snapshot,
      removalCandidateId: providerId,
    });
  }

  cancelRemoveProvider(): void {
    if (
      this._snapshot.removalCandidateId === null ||
      this._snapshot.removingProviderId !== null
    ) {
      return;
    }
    this._setSnapshot({ ...this._snapshot, removalCandidateId: null });
  }

  async confirmRemoveProvider(): Promise<void> {
    const providerId = this._snapshot.removalCandidateId;
    if (
      this._closed ||
      providerId === null ||
      this._snapshot.removingProviderId !== null
    ) {
      return;
    }
    const lease: RemovalLease = { epoch: this._epoch, providerId };
    this._setSnapshot({
      ...this._snapshot,
      removalCandidateId: null,
      removingProviderId: providerId,
    });
    try {
      await this._options.removeProvider(providerId);
      if (!this._isCurrentRemoval(lease)) return;
      this._setSnapshot({
        ...this._snapshot,
        removingProviderId: null,
      });
    } catch (error) {
      if (!this._isCurrentRemoval(lease)) return;
      this._setSnapshot({ ...this._snapshot, removingProviderId: null });
      this._options.mutationFailed(
        { operation: "remove-provider", providerId },
        error
      );
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._epoch += 1;
    this._unsubscribeProfiles();
    this.addProvider.setOpen(false);
    this.metadata.close();
    this.profiles.close();
    this.profile.close();
    this._pendingSelectionId = null;
    this._setSnapshot(EMPTY_SNAPSHOT);
    this._listeners.clear();
  }

  private _providerAdded(providerId: string): void {
    if (this._closed) return;
    this._pendingSelectionId = providerId;
    if (
      this._snapshot.providers.some((provider) => provider.id === providerId)
    ) {
      this.selectProvider(providerId);
    }
  }

  private _syncFocusedControllers(): void {
    const provider = this.getSelectedProvider();
    this.metadata.sync(_metadataTarget(provider));
    this.profiles.sync(_profilesTarget(provider));
    this._syncSelectedProfile();
  }

  private _syncSelectedProfile(): void {
    if (this._closed) return;
    const provider = this.getSelectedProvider();
    const profile = provider?.profiles.find(
      (candidate) =>
        candidate.id === this.profiles.getSnapshot().selectedProfileId
    );
    const target: ProviderProfileTarget | null =
      provider && profile ? { providerId: provider.id, profile } : null;
    this.profile.sync(target);
  }

  private _isCurrentRemoval(lease: RemovalLease): boolean {
    return (
      !this._closed &&
      lease.epoch === this._epoch &&
      this._snapshot.removingProviderId === lease.providerId
    );
  }

  private _setSnapshot(snapshot: ModelsSettingsSnapshot): void {
    if (_sameSnapshot(snapshot, this._snapshot)) return;
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}

function _firstProviderId(
  providers: readonly ModelProviderGroup[]
): string | null {
  return (
    [...providers].sort((left, right) =>
      left.name.localeCompare(right.name)
    )[0]?.id ?? null
  );
}

function _metadataTarget(
  provider: ModelProviderGroup | null
): ProviderMetadataTarget | null {
  return provider
    ? {
        providerId: provider.id,
        name: provider.name,
        api: provider.api ?? "openai-completions",
        icon: provider.icon ?? "",
      }
    : null;
}

function _profilesTarget(
  provider: ModelProviderGroup | null
): ProviderProfilesTarget | null {
  return provider
    ? {
        providerId: provider.id,
        profiles: provider.profiles.map(({ id, name }) => ({ id, name })),
      }
    : null;
}

function _sameSnapshot(
  left: ModelsSettingsSnapshot,
  right: ModelsSettingsSnapshot
): boolean {
  return (
    left.providers === right.providers &&
    left.selectedProviderId === right.selectedProviderId &&
    left.removalCandidateId === right.removalCandidateId &&
    left.removingProviderId === right.removingProviderId
  );
}
