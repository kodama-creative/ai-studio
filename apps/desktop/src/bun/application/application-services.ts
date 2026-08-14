import type { GistThreadWriter } from "@llm-space/core/storage";
import { GIST_CONNECTOR_ID } from "@llm-space/core/storage";

import type { AnalyticsEvent } from "../../shared/analytics";
import type { GithubAuthState } from "../../shared/auth";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type { FeatureReminder } from "../../shared/feature-reminders";
import type { RuntimeId } from "../../shared/runtime";
import { buildWebShareUrl } from "../../shared/share";
import type {
  UpdateMode,
  UpdateStatusChangedPayload,
} from "../../shared/updates";
import type { Analytics } from "../analytics";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import {
  dismissGithubStarReminder,
  getNextFeatureReminder,
  markFeatureReminderSeen,
  resolveGithubStarReminder,
} from "../reminders/state";
import type { UpdaterService } from "../updates";

import type {
  ModelsApplication,
  WorkspaceApplication,
} from "./runtime-applications";
import { buildSharedThread } from "./thread-sharing";

export interface ThreadSharingApplicationApi {
  read(runtimeId: RuntimeId, path: string): ReturnType<WorkspaceApplication["readThread"]>;
  publish(runtimeId: RuntimeId, path: string, meta?: { title?: string; description?: string }): Promise<{ shareUrl: string; gistId: string }>;
}
export interface GithubAccountApplicationApi {
  getState(): Promise<GithubAuthState>;
  login(): Promise<void>;
  logout(): void;
}
export interface UpdatesApplicationApi {
  getMode(): Promise<UpdateMode>;
  setMode(mode: UpdateMode): Promise<void>;
  takeInstalledVersion(): Promise<string | null>;
  check(): Promise<void>;
  applyAndRestart(): Promise<void>;
}
export interface RemindersApplicationApi {
  shouldShowGithubStar(): Promise<{ show: boolean }>;
  dismissGithubStarForever(): Promise<void>;
  nextFeature(): Promise<FeatureReminder | null>;
  markFeatureSeen(id: string): Promise<void>;
}
export interface AnalyticsApplicationApi {
  getSettings(): Promise<ReturnType<Analytics["getSettings"]>>;
  setEnabled(enabled: boolean): Promise<ReturnType<Analytics["setEnabled"]>>;
  capture(input: AnalyticsEvent): Promise<void>;
}
export interface GithubAccountApplicationEvents {
  changed: GithubAuthState;
}
export interface UpdatesApplicationEvents {
  statusChanged: UpdateStatusChangedPayload;
}

/** Publishes immutable Thread copies through the configured sharing connector. */
export class ThreadSharingApplication implements ThreadSharingApplicationApi {
  constructor(
    private readonly _workspace: WorkspaceApplication,
    private readonly _models: ModelsApplication,
    private readonly _writer: Pick<GistThreadWriter, "write">
  ) {}
  read(runtimeId: RuntimeId, path: string) {
    return this._workspace.readThread(runtimeId, path);
  }
  async publish(
    runtimeId: RuntimeId,
    path: string,
    meta: { title?: string; description?: string } = {}
  ) {
    const [thread, providers, defaultModel] = await Promise.all([
      this._workspace.readThread(runtimeId, path),
      this._models.list(runtimeId),
      this._models.getDefault(runtimeId),
    ]);
    const locator = await this._writer.write(
      buildSharedThread(thread, providers, defaultModel, meta.title),
      undefined,
      { description: meta.description }
    );
    return {
      gistId: locator.id,
      shareUrl: buildWebShareUrl(GIST_CONNECTOR_ID, locator.id),
    };
  }
}

/** Read-only account state plus a process-local change event. */
export class GithubAccountApplication
  implements GithubAccountApplicationApi, Disposable
{
  readonly events = new EventHub<GithubAccountApplicationEvents>();
  constructor(private readonly _auth: GitHubAuthManager) {}
  getState() {
    return Promise.resolve(this._auth.getState());
  }
  login() {
    return this._auth.signIn();
  }
  logout(): void {
    this._auth.signOut();
  }
  notifyChanged(state: GithubAuthState): void {
    this.events.publish("changed", state);
  }
  /** Release process-local account observers. */
  dispose(): void {
    this.events.dispose();
  }
}

/** Update preferences/status exposed independently from update commands. */
export class UpdatesApplication implements UpdatesApplicationApi, Disposable {
  readonly events = new EventHub<UpdatesApplicationEvents>();
  constructor(private readonly _updater: UpdaterService) {}
  getMode() {
    return this._updater.getUpdateModeSetting();
  }
  setMode(mode: UpdateMode) {
    return this._updater.setUpdateModeSetting(mode);
  }
  takeInstalledVersion() {
    return Promise.resolve(this._updater.getInstalledVersion());
  }
  check() {
    return this._updater.checkForUpdates(true);
  }
  applyAndRestart() {
    return this._updater.applyUpdateAndRestart();
  }
  notifyStatus(payload: UpdateStatusChangedPayload): void {
    this.events.publish("statusChanged", payload);
  }
  /** Release process-local update observers. */
  dispose(): void {
    this.events.dispose();
  }
}

/** One-time product reminders; persistence remains owned by the reminder store. */
export class RemindersApplication implements RemindersApplicationApi {
  shouldShowGithubStar() {
    return resolveGithubStarReminder();
  }
  dismissGithubStarForever() {
    return dismissGithubStarReminder();
  }
  nextFeature() {
    return getNextFeatureReminder();
  }
  markFeatureSeen(id: string) {
    return markFeatureReminderSeen(id);
  }
}

/** Analytics preferences and explicitly allowed anonymous event capture. */
export class AnalyticsApplication implements AnalyticsApplicationApi {
  constructor(private readonly _analytics: Analytics) {}
  getSettings() {
    return Promise.resolve(this._analytics.getSettings());
  }
  setEnabled(enabled: boolean) {
    return Promise.resolve(this._analytics.setEnabled(enabled));
  }
  capture(input: AnalyticsEvent) {
    this._analytics.capture(input.event, input.properties);
    return Promise.resolve();
  }
}
