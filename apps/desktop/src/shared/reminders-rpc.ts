import type { FeatureReminder } from "./feature-reminders";
import { defineRpcNamespace } from "./namespaced-rpc";

export const REMINDERS_SERVICE = Symbol("RemindersService");

export interface RemindersRequests {
  shouldShowGithubStar(): Promise<{ show: boolean }>;
  dismissGithubStarForever(): Promise<void>;
  nextFeature(): Promise<FeatureReminder | null>;
  markFeatureSeen(id: string): Promise<void>;
}

export interface RemindersRpc {
  readonly requests: RemindersRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export const REMINDERS_RPC = defineRpcNamespace<RemindersRpc>("reminders", {
  requests: {
    shouldShowGithubStar: true,
    dismissGithubStarForever: true,
    nextFeature: true,
    markFeatureSeen: true,
  },
  streams: {},
  events: {},
});
