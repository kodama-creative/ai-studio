import type { ModelProviderGroup } from "@llm-space/core";
import { inject, injectable } from "inversify";

import { DesktopModelCatalogController } from "../models/desktop-model-catalog-controller";
import { RendererNotificationService } from "../notifications/renderer-notification-service";

export const ONBOARDING_NEEDS_DISCOVERY = Symbol("OnboardingNeedsDiscovery");

export interface OnboardingSnapshot {
  readonly builtinProviders: readonly ModelProviderGroup[] | null;
  readonly providerDiscoveryFailed: boolean;
  readonly addingProviderId: string | null;
  readonly addedProviderName: string | null;
}

type Listener = () => void;

const INITIAL_SNAPSHOT: OnboardingSnapshot = {
  builtinProviders: null,
  providerDiscoveryFailed: false,
  addingProviderId: null,
  addedProviderName: null,
};

/** Owns one open Onboarding dialog's provider discovery and add lifecycle. */
@injectable()
export class OnboardingController {
  private readonly _catalog: Pick<
    DesktopModelCatalogController,
    "builtinProviders" | "addProvider"
  >;
  private readonly _notifications: Pick<
    RendererNotificationService,
    "success" | "error"
  >;
  private readonly _listeners = new Set<Listener>();
  private _lifecycle = 0;
  private _discoveryRequest = 0;
  private _open = false;
  private _needsDiscovery = false;
  private _snapshot: OnboardingSnapshot = INITIAL_SNAPSHOT;

  constructor(
    @inject(DesktopModelCatalogController)
    catalog: Pick<
      DesktopModelCatalogController,
      "builtinProviders" | "addProvider"
    >,
    @inject(RendererNotificationService)
    notifications: Pick<
      RendererNotificationService,
      "success" | "error"
    >,
    @inject(ONBOARDING_NEEDS_DISCOVERY)
    initialNeedsDiscovery = false
  ) {
    this._catalog = catalog;
    this._notifications = notifications;
    this._initialNeedsDiscovery = initialNeedsDiscovery;
  }

  private readonly _initialNeedsDiscovery: boolean;

  readonly getSnapshot = (): OnboardingSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.open(this._initialNeedsDiscovery);
  }

  stop(): void {
    this.close();
  }

  /** Open or update the current dialog session without restarting mutations. */
  open(needsDiscovery: boolean): void {
    if (!this._open) {
      this._open = true;
      this._lifecycle += 1;
      this._needsDiscovery = needsDiscovery;
      this._discoveryRequest += 1;
      this._setSnapshot(INITIAL_SNAPSHOT);
      if (needsDiscovery) void this._discoverProviders();
      return;
    }
    if (this._needsDiscovery === needsDiscovery) return;
    this._needsDiscovery = needsDiscovery;
    this._discoveryRequest += 1;
    if (needsDiscovery) {
      this._setSnapshot({
        ...this._snapshot,
        builtinProviders: null,
        providerDiscoveryFailed: false,
      });
      void this._discoverProviders();
    }
  }

  /** Invalidate every in-flight result and reset the next open session. */
  close(): void {
    if (!this._open) return;
    this._open = false;
    this._needsDiscovery = false;
    this._lifecycle += 1;
    this._discoveryRequest += 1;
    this._setSnapshot(INITIAL_SNAPSHOT);
  }

  /** Apply at most one provider mutation for the current dialog session. */
  async addProvider(provider: ModelProviderGroup): Promise<void> {
    if (!this._open || this._snapshot.addingProviderId !== null) return;
    const lifecycle = this._lifecycle;
    this._setSnapshot({
      ...this._snapshot,
      addingProviderId: provider.id,
    });
    try {
      await this._catalog.addProvider(provider.id);
      if (!this._isCurrent(lifecycle)) return;
      this._setSnapshot({
        ...this._snapshot,
        addingProviderId: null,
        addedProviderName: provider.name,
      });
      this._notifications.success(`${provider.name} is ready`);
    } catch (error) {
      if (!this._isCurrent(lifecycle)) return;
      this._setSnapshot({ ...this._snapshot, addingProviderId: null });
      this._notifications.error("Could not add provider", error);
    }
  }

  private async _discoverProviders(): Promise<void> {
    const lifecycle = this._lifecycle;
    const request = this._discoveryRequest;
    try {
      const builtinProviders = await this._catalog.builtinProviders();
      if (!this._isCurrentDiscovery(lifecycle, request)) return;
      this._setSnapshot({
        ...this._snapshot,
        builtinProviders,
        providerDiscoveryFailed: false,
      });
    } catch {
      if (!this._isCurrentDiscovery(lifecycle, request)) return;
      this._setSnapshot({
        ...this._snapshot,
        builtinProviders: [],
        providerDiscoveryFailed: true,
      });
    }
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._open && this._lifecycle === lifecycle;
  }

  private _isCurrentDiscovery(lifecycle: number, request: number): boolean {
    return (
      this._isCurrent(lifecycle) &&
      this._needsDiscovery &&
      this._discoveryRequest === request
    );
  }

  private _setSnapshot(snapshot: OnboardingSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
