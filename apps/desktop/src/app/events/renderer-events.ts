import EventEmitter from "eventemitter3";

import type { ModelsSettingsFailure } from "../settings/models/models-settings-controller";

export interface RendererEvents {
  "notification:success": [message: string];
  "notification:error": [title: string, error?: unknown];
  "models:mutation-failed": [failure: ModelsSettingsFailure, error: unknown];
  "models:provider-added": [providerId: string];
  "onboarding:provider-added": [providerName: string];
  "onboarding:add-failed": [error: unknown];
  "settings:save-failed": [setting: string, error: unknown];
  "updates:downloading": [version: string];
  "updates:ready": [version: string];
  "updates:installed": [version: string];
}

export type RendererEventEmitter = EventEmitter<RendererEvents>;

export function createRendererEventEmitter(): RendererEventEmitter {
  return new EventEmitter<RendererEvents>();
}
