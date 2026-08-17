import type { ModelProviderGroup } from "@llm-space/core";
import { inject, injectable } from "inversify";

import type { Disposable } from "@/shared/disposable";

import { DesktopModelCatalogController } from "../../models/desktop-model-catalog-controller";
import { RendererNotificationService } from "../../notifications/renderer-notification-service";

import {
  AddProviderController,
  type AddProviderChoice,
  type AddProviderSnapshot,
} from "./add-provider-controller";
import { reportModelMutationFailure } from "./model-notifications";
import {
  ProviderMetadataController,
  type ProviderMetadataField,
  type ProviderMetadataSnapshot,
  type ProviderMetadataTextField,
  type ProviderMetadataTarget,
} from "./provider-metadata-controller";
import {
  ProviderProfileController,
  type ProviderProfileField,
  type ProviderProfileSnapshot,
  type ProviderProfileTextField,
  type ProviderProfileTarget,
} from "./provider-profile-controller";
import {
  ProviderProfilesController,
  type ProviderProfilesOperation,
  type ProviderProfilesSnapshot,
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

export interface ModelsSettingsSnapshot {
  readonly providers: readonly ModelProviderGroup[];
  readonly selectedProviderId: string | null;
  readonly removalCandidateId: string | null;
  readonly removingProviderId: string | null;
  readonly addProvider: AddProviderSnapshot;
  readonly metadata: ProviderMetadataSnapshot;
  readonly profiles: ProviderProfilesSnapshot;
  readonly profile: ProviderProfileSnapshot;
}

interface ModelsCatalogPort {
  getSnapshot(): { readonly providers?: readonly ModelProviderGroup[] | null };
  subscribe(listener: () => void): () => void;
  removeProvider(providerId: string): Promise<void>;
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
  addProvider: {
    open: false,
    builtinProviders: null,
    discoveryFailed: false,
    addingProviderId: null,
  },
  metadata: {
    providerId: "",
    name: "",
    api: "openai-completions",
    icon: "",
  },
  profiles: {
    mutation: null,
    providerId: "",
    removalCandidateId: null,
    selectedProfileId: "",
  },
  profile: {
    providerId: "",
    profileId: "",
    name: "",
    apiKey: "",
    baseUrl: "",
    baseUrlEnabled: false,
    headers: [],
  },
};

/**
 * Application module for the complete Models Settings workflow.
 *
 * The shared ModelCatalogController remains the catalog and mutation authority.
 * This aggregate owns settings-local selection, removal admission and the
 * lifecycle of the focused provider/profile editors projected from that
 * catalog. It has no React, Electrobun or toast dependency.
 */
@injectable()
export class ModelsSettingsController {
  private readonly _catalog: ModelsCatalogPort;
  private readonly _notifications: Pick<
    RendererNotificationService,
    "error"
  >;
  private readonly _listeners = new Set<Listener>();
  private readonly _addProvider: AddProviderController;
  private readonly _metadata: ProviderMetadataController;
  private readonly _profiles: ProviderProfilesController;
  private readonly _profile: ProviderProfileController;
  private _unsubscribeChildren: (() => void)[] = [];
  private _unsubscribeCatalog: (() => void) | null = null;
  private _providerAddedSubscription: Disposable | null = null;
  private _unsubscribeProfiles: (() => void) | null = null;
  private _started = false;
  private _epoch = 0;
  private _pendingSelectionId: string | null = null;
  private _snapshot: ModelsSettingsSnapshot = EMPTY_SNAPSHOT;

  readonly intents = {
    addProvider: {
      setOpen: (open: boolean) => this._addProvider.setOpen(open),
      choose: (choice: AddProviderChoice) => this._addProvider.choose(choice),
    },
    metadata: {
      draft: (field: ProviderMetadataTextField, value: string) =>
        this._metadata.draft(field, value),
      commit: (field: ProviderMetadataTextField) =>
        this._metadata.commit(field),
      selectApi: (api: ProviderMetadataSnapshot["api"]) =>
        this._metadata.selectApi(api),
    },
    profiles: {
      select: (profileId: string) => this._profiles.select(profileId),
      requestRemove: (profileId: string) =>
        this._profiles.requestRemove(profileId),
      cancelRemove: () => this._profiles.cancelRemove(),
      add: () => this._profiles.add(),
      confirmRemove: () => this._profiles.confirmRemove(),
    },
    profile: {
      draft: (field: ProviderProfileTextField, value: string) =>
        this._profile.draft(field, value),
      commit: (field: ProviderProfileTextField) => this._profile.commit(field),
      setBaseUrlEnabled: (enabled: boolean) =>
        this._profile.setBaseUrlEnabled(enabled),
      editHeader: (rowId: string, field: "key" | "value", value: string) =>
        this._profile.editHeader(rowId, field, value),
      commitHeaders: () => this._profile.commitHeaders(),
      removeHeader: (rowId: string) => this._profile.removeHeader(rowId),
      addHeader: () => this._profile.addHeader(),
    },
  } as const;

  constructor(
    @inject(DesktopModelCatalogController)
    catalog: ModelsCatalogPort,
    @inject(RendererNotificationService)
    notifications: Pick<RendererNotificationService, "error">,
    @inject(AddProviderController)
    addProvider: AddProviderController,
    @inject(ProviderMetadataController) metadata: ProviderMetadataController,
    @inject(ProviderProfilesController) profiles: ProviderProfilesController,
    @inject(ProviderProfileController) profile: ProviderProfileController
  ) {
    this._catalog = catalog;
    this._notifications = notifications;
    this._addProvider = addProvider;
    this._metadata = metadata;
    this._profiles = profiles;
    this._profile = profile;
    this.syncCatalog(catalog.getSnapshot().providers ?? []);
  }

  readonly getSnapshot = (): ModelsSettingsSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    if (this._started) return;
    this._started = true;
    this._epoch += 1;
    this._unsubscribeProfiles = this._profiles.subscribe(() => {
      this._syncSelectedProfile();
    });
    this._unsubscribeChildren = [
      this._addProvider.subscribe(this._publishChildren),
      this._metadata.subscribe(this._publishChildren),
      this._profiles.subscribe(this._publishChildren),
      this._profile.subscribe(this._publishChildren),
    ];
    this._unsubscribeCatalog = this._catalog.subscribe(() => {
      this.syncCatalog(this._catalog.getSnapshot().providers ?? []);
    });
    this.syncCatalog(this._catalog.getSnapshot().providers ?? []);
    this._providerAddedSubscription = this._addProvider.onDidAddProvider(
      this._providerAdded
    );
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._epoch += 1;
    this._unsubscribeCatalog?.();
    this._unsubscribeCatalog = null;
    void this._providerAddedSubscription?.dispose();
    this._providerAddedSubscription = null;
    this._unsubscribeProfiles?.();
    this._unsubscribeProfiles = null;
    for (const unsubscribe of this._unsubscribeChildren) unsubscribe();
    this._unsubscribeChildren = [];
    this._addProvider.setOpen(false);
    this._metadata.clearTarget();
    this._profiles.clearTarget();
    this._profile.clearTarget();
    this._pendingSelectionId = null;
    this._setSnapshot({
      ...this._snapshot,
      removalCandidateId: null,
      removingProviderId: null,
    });
  }

  getSelectedProvider(): ModelProviderGroup | null {
    return (
      this._snapshot.providers.find(
        (provider) => provider.id === this._snapshot.selectedProviderId
      ) ?? null
    );
  }

  /** Synchronize the authoritative ModelCatalogController projection. */
  syncCatalog(providers: readonly ModelProviderGroup[]): void {
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
      !this._started ||
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
      !this._started ||
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
      !this._started ||
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
      await this._catalog.removeProvider(providerId);
      if (!this._isCurrentRemoval(lease)) return;
      this._setSnapshot({
        ...this._snapshot,
        removingProviderId: null,
      });
    } catch (error) {
      if (!this._isCurrentRemoval(lease)) return;
      this._setSnapshot({ ...this._snapshot, removingProviderId: null });
      reportModelMutationFailure(
        this._notifications,
        { operation: "remove-provider", providerId },
        error
      );
    }
  }

  private readonly _providerAdded = (providerId: string): void => {
    if (!this._started) return;
    this._pendingSelectionId = providerId;
    if (
      this._snapshot.providers.some((provider) => provider.id === providerId)
    ) {
      this.selectProvider(providerId);
    }
  };

  private _syncFocusedControllers(): void {
    const provider = this.getSelectedProvider();
    this._metadata.sync(_metadataTarget(provider));
    this._profiles.sync(_profilesTarget(provider));
    this._syncSelectedProfile();
  }

  private _syncSelectedProfile(): void {
    if (!this._started) return;
    const provider = this.getSelectedProvider();
    const profile = provider?.profiles.find(
      (candidate) =>
        candidate.id === this._profiles.getSnapshot().selectedProfileId
    );
    const target: ProviderProfileTarget | null =
      provider && profile ? { providerId: provider.id, profile } : null;
    this._profile.sync(target);
  }

  private _isCurrentRemoval(lease: RemovalLease): boolean {
    return (
      this._started &&
      lease.epoch === this._epoch &&
      this._snapshot.removingProviderId === lease.providerId
    );
  }

  private _setSnapshot(
    snapshot: Pick<
      ModelsSettingsSnapshot,
      | "providers"
      | "selectedProviderId"
      | "removalCandidateId"
      | "removingProviderId"
    > &
      Partial<ModelsSettingsSnapshot>
  ): void {
    const composed: ModelsSettingsSnapshot = {
      ...snapshot,
      addProvider: this._addProvider.getSnapshot(),
      metadata: this._metadata.getSnapshot(),
      profiles: this._profiles.getSnapshot(),
      profile: this._profile.getSnapshot(),
    };
    if (_sameSnapshot(composed, this._snapshot)) return;
    this._snapshot = composed;
    for (const listener of this._listeners) listener();
  }

  private readonly _publishChildren = (): void => {
    this._setSnapshot(this._snapshot);
  };
}

function _firstProviderId(
  providers: readonly ModelProviderGroup[]
): string | null {
  return (
    [...providers].sort((left, right) => left.name.localeCompare(right.name))[0]
      ?.id ?? null
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
    left.removingProviderId === right.removingProviderId &&
    left.addProvider === right.addProvider &&
    left.metadata === right.metadata &&
    left.profiles === right.profiles &&
    left.profile === right.profile
  );
}
