import { toast } from "sonner";

import type { RendererLifecycleContribution } from "../di/lifecycle";
import type { ModelsSettingsFailure } from "../settings/models/models-settings-controller";

import type { RendererEventEmitter } from "./renderer-events";

export class RendererEventEffects implements RendererLifecycleContribution {
  private _started = false;

  constructor(private readonly _events: RendererEventEmitter) {}

  start(): void {
    if (this._started) return;
    this._started = true;
    this._events.on("notification:success", this._success);
    this._events.on("notification:error", this._error);
    this._events.on("models:mutation-failed", this._modelsFailure);
    this._events.on("onboarding:provider-added", this._providerAdded);
    this._events.on("onboarding:add-failed", this._onboardingFailure);
    this._events.on("settings:save-failed", this._settingsFailure);
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._events.off("notification:success", this._success);
    this._events.off("notification:error", this._error);
    this._events.off("models:mutation-failed", this._modelsFailure);
    this._events.off("onboarding:provider-added", this._providerAdded);
    this._events.off("onboarding:add-failed", this._onboardingFailure);
    this._events.off("settings:save-failed", this._settingsFailure);
  }

  private readonly _success = (message: string): void => {
    toast.success(message);
  };

  private readonly _error = (title: string, error?: unknown): void => {
    toast.error(title, {
      ...(error === undefined ? {} : { description: _message(error) }),
    });
  };

  private readonly _modelsFailure = (
    failure: ModelsSettingsFailure,
    error: unknown
  ): void => {
    toast.error(_modelsFailureTitle(failure), { description: _message(error) });
  };

  private readonly _providerAdded = (providerName: string): void => {
    toast.success(`${providerName} is ready`);
  };

  private readonly _onboardingFailure = (error: unknown): void => {
    toast.error("Could not add provider", { description: _message(error) });
  };

  private readonly _settingsFailure = (
    setting: string,
    error: unknown
  ): void => {
    toast.error(`Failed to update ${setting}`, {
      description: _message(error),
    });
  };
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}

function _modelsFailureTitle(failure: ModelsSettingsFailure): string {
  switch (failure.operation) {
    case "add-provider":
      return `Failed to add ${failure.providerName}`;
    case "remove-provider":
      return "Failed to remove provider";
    case "save-provider-metadata":
      return "Failed to update provider";
    case "mutate-provider-profiles":
      return "Failed to update provider profiles";
    case "save-provider-profile":
      return "Failed to update provider profile";
  }
}
