import type { PortableThreadSnapshot } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";

import type { AnalyticsEvent, AnalyticsStatus } from "./analytics";
import type { GithubAuthState } from "./auth";
import type { FeatureReminder } from "./feature-reminders";
import { defineRpcNamespace } from "./namespaced-rpc";
import type { UpdateMode, UpdateStatusChangedPayload } from "./updates";

export interface ThreadSharingRequests {
  read(playgroundId: string): Promise<PortableThreadSnapshot>;
  publish(
    playgroundId: string,
    meta?: { title?: string; description?: string }
  ): Promise<{ shareUrl: string; gistId: string }>;
  importSnapshot(snapshot: PortableThreadSnapshot): Promise<Playground>;
  importGist(gistId: string): Promise<Playground>;
}
export interface ThreadSharingRpc {
  readonly requests: ThreadSharingRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}
export const THREAD_SHARING_RPC = defineRpcNamespace<ThreadSharingRpc>(
  "threadSharing",
  {
    requests: {
      read: true,
      publish: true,
      importSnapshot: true,
      importGist: true,
    },
    streams: {},
    events: {},
  }
);

export interface GithubAccountRequests {
  getState(): Promise<GithubAuthState>;
}
export interface GithubAccountEvents {
  changed: GithubAuthState;
}
export interface GithubAccountRpc {
  readonly requests: GithubAccountRequests;
  readonly streams: Record<never, never>;
  readonly events: GithubAccountEvents;
}
export const GITHUB_ACCOUNT_RPC = defineRpcNamespace<GithubAccountRpc>(
  "githubAccount",
  {
    requests: { getState: true },
    streams: {},
    events: { changed: true },
  }
);

export interface UpdatesRequests {
  getMode(): Promise<UpdateMode>;
  setMode(mode: UpdateMode): Promise<void>;
  takeInstalledVersion(): Promise<string | null>;
}
export interface UpdatesEvents {
  statusChanged: UpdateStatusChangedPayload;
}
export interface UpdatesRpc {
  readonly requests: UpdatesRequests;
  readonly streams: Record<never, never>;
  readonly events: UpdatesEvents;
}
export const UPDATES_RPC = defineRpcNamespace<UpdatesRpc>("updates", {
  requests: { getMode: true, setMode: true, takeInstalledVersion: true },
  streams: {},
  events: { statusChanged: true },
});

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

export interface AnalyticsRequests {
  getSettings(): Promise<AnalyticsStatus>;
  setEnabled(enabled: boolean): Promise<AnalyticsStatus>;
  capture(event: AnalyticsEvent): Promise<void>;
}
export interface AnalyticsRpc {
  readonly requests: AnalyticsRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}
export const ANALYTICS_RPC = defineRpcNamespace<AnalyticsRpc>("analytics", {
  requests: { getSettings: true, setEnabled: true, capture: true },
  streams: {},
  events: {},
});
