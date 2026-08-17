import type { ProviderProfile } from "@llm-space/core";
import { inject, injectable } from "inversify";

import { DesktopModelCatalogController } from "../../models/desktop-model-catalog-controller";
import { RendererNotificationService } from "../../notifications/renderer-notification-service";

import { reportModelMutationFailure } from "./model-notifications";

export type ProviderProfilesMutation = "adding" | "removing";
export type ProviderProfilesOperation = "add" | "remove";

export interface ProviderProfilesTarget {
  readonly providerId: string;
  readonly profiles: readonly Pick<ProviderProfile, "id" | "name">[];
}

export interface ProviderProfilesSnapshot {
  readonly mutation: ProviderProfilesMutation | null;
  readonly providerId: string;
  readonly removalCandidateId: string | null;
  readonly selectedProfileId: string;
}

interface MutationLease {
  readonly epoch: number;
  readonly providerId: string;
}

type Listener = () => void;

const EMPTY_SNAPSHOT: ProviderProfilesSnapshot = {
  mutation: null,
  providerId: "",
  removalCandidateId: null,
  selectedProfileId: "",
};

/**
 * Owns one provider's connection-profile collection workflow.
 *
 * Selection always resolves against the authoritative collection. Add and
 * remove share one mutation lease, while retargeting invalidates every result
 * from the previous provider.
 */
@injectable()
export class ProviderProfilesController {
  private readonly _catalog: Pick<
    DesktopModelCatalogController,
    "addProviderProfile" | "removeProviderProfile"
  >;
  private readonly _notifications: Pick<
    RendererNotificationService,
    "error"
  >;
  private readonly _listeners = new Set<Listener>();
  private _epoch = 0;
  private _profiles: ProviderProfilesTarget["profiles"] = [];
  private _snapshot: ProviderProfilesSnapshot = EMPTY_SNAPSHOT;

  constructor(
    @inject(DesktopModelCatalogController)
    catalog: Pick<
      DesktopModelCatalogController,
      "addProviderProfile" | "removeProviderProfile"
    >,
    @inject(RendererNotificationService)
    notifications: Pick<RendererNotificationService, "error">
  ) {
    this._catalog = catalog;
    this._notifications = notifications;
  }

  readonly getSnapshot = (): ProviderProfilesSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  sync(target: ProviderProfilesTarget | null): void {
    if (target === null) {
      this.clearTarget();
      return;
    }
    if (target.providerId !== this._snapshot.providerId) {
      this._retarget(target);
      return;
    }

    this._profiles = [...target.profiles];
    const profileIds = new Set(this._profiles.map((profile) => profile.id));
    this._setSnapshot({
      ...this._snapshot,
      removalCandidateId:
        this._snapshot.removalCandidateId &&
        profileIds.has(this._snapshot.removalCandidateId)
          ? this._snapshot.removalCandidateId
          : null,
      selectedProfileId: profileIds.has(this._snapshot.selectedProfileId)
        ? this._snapshot.selectedProfileId
        : (this._profiles[0]?.id ?? ""),
    });
  }

  clearTarget(): void {
    if (this._snapshot.providerId === "") return;
    this._epoch += 1;
    this._profiles = [];
    this._setSnapshot(EMPTY_SNAPSHOT);
  }

  select(profileId: string): void {
    if (
      this._snapshot.providerId === "" ||
      profileId === this._snapshot.selectedProfileId ||
      !this._profiles.some((profile) => profile.id === profileId)
    ) {
      return;
    }
    this._setSnapshot({ ...this._snapshot, selectedProfileId: profileId });
  }

  requestRemove(profileId: string): void {
    if (
      this._snapshot.providerId === "" ||
      this._snapshot.mutation !== null ||
      this._profiles.findIndex((profile) => profile.id === profileId) <= 0
    ) {
      return;
    }
    this._setSnapshot({
      ...this._snapshot,
      removalCandidateId: profileId,
    });
  }

  cancelRemove(): void {
    if (this._snapshot.removalCandidateId === null) return;
    this._setSnapshot({ ...this._snapshot, removalCandidateId: null });
  }

  async add(): Promise<void> {
    const lease = this._begin("adding");
    if (!lease) return;
    try {
      const profileId = await this._catalog.addProviderProfile(
        lease.providerId
      );
      if (!this._isCurrent(lease)) return;
      this._setSnapshot({
        ...this._snapshot,
        mutation: null,
        selectedProfileId: profileId,
      });
    } catch (error) {
      if (!this._isCurrent(lease)) return;
      this._setSnapshot({ ...this._snapshot, mutation: null });
      reportModelMutationFailure(
        this._notifications,
        { operation: "mutate-provider-profiles", mutation: "add" },
        error
      );
    }
  }

  async confirmRemove(): Promise<void> {
    const profileId = this._snapshot.removalCandidateId;
    if (profileId === null) return;
    const lease = this._begin("removing");
    if (!lease) return;
    try {
      await this._catalog.removeProviderProfile(lease.providerId, profileId);
      if (!this._isCurrent(lease)) return;
      this._profiles = this._profiles.filter(
        (profile) => profile.id !== profileId
      );
      this._setSnapshot({
        ...this._snapshot,
        mutation: null,
        selectedProfileId:
          this._snapshot.selectedProfileId === profileId
            ? (this._profiles[0]?.id ?? "")
            : this._snapshot.selectedProfileId,
      });
    } catch (error) {
      if (!this._isCurrent(lease)) return;
      this._setSnapshot({ ...this._snapshot, mutation: null });
      reportModelMutationFailure(
        this._notifications,
        { operation: "mutate-provider-profiles", mutation: "remove" },
        error
      );
    }
  }

  private _begin(mutation: ProviderProfilesMutation): MutationLease | null {
    if (this._snapshot.providerId === "" || this._snapshot.mutation !== null) {
      return null;
    }
    const lease = {
      epoch: this._epoch,
      providerId: this._snapshot.providerId,
    };
    this._setSnapshot({
      ...this._snapshot,
      mutation,
      removalCandidateId: null,
    });
    return lease;
  }

  private _retarget(target: ProviderProfilesTarget): void {
    this._epoch += 1;
    this._profiles = [...target.profiles];
    this._setSnapshot({
      mutation: null,
      providerId: target.providerId,
      removalCandidateId: null,
      selectedProfileId: this._profiles[0]?.id ?? "",
    });
  }

  private _isCurrent(lease: MutationLease): boolean {
    return (
      lease.epoch === this._epoch &&
      lease.providerId === this._snapshot.providerId
    );
  }

  private _setSnapshot(snapshot: ProviderProfilesSnapshot): void {
    if (
      snapshot.mutation === this._snapshot.mutation &&
      snapshot.providerId === this._snapshot.providerId &&
      snapshot.removalCandidateId === this._snapshot.removalCandidateId &&
      snapshot.selectedProfileId === this._snapshot.selectedProfileId
    ) {
      return;
    }
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
