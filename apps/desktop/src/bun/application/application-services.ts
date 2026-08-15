import type { PortableThreadSnapshot } from "@llm-space/core";
import type {
  GistThreadReader,
  GistThreadWriter,
} from "@llm-space/core/storage";
import { GIST_CONNECTOR_ID } from "@llm-space/core/storage";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
} from "@llm-space/studio";

import type { AnalyticsEvent } from "../../shared/analytics";
import type { GithubAuthState } from "../../shared/auth";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type { FeatureReminder } from "../../shared/feature-reminders";
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

import type { DesktopPlaygroundApplication } from "./playground-application";
import type { ModelsApplication } from "./runtime-applications";
import { buildSharedThread } from "./thread-sharing";

export interface ThreadSharingApplicationApi {
  read(playgroundId: string): Promise<PortableThreadSnapshot>;
  publish(playgroundId: string, meta?: { title?: string; description?: string }): Promise<{ shareUrl: string; gistId: string }>;
  importSnapshot(snapshot: PortableThreadSnapshot): ReturnType<DesktopPlaygroundApplication["create"]>;
  importGist(gistId: string): ReturnType<DesktopPlaygroundApplication["create"]>;
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
    private readonly _playgrounds: DesktopPlaygroundApplication,
    private readonly _models: ModelsApplication,
    private readonly _writer: Pick<GistThreadWriter, "writeSnapshot">,
    private readonly _reader: Pick<GistThreadReader, "readSnapshot">
  ) {}
  async read(playgroundId: string): Promise<PortableThreadSnapshot> {
    const [playground, providers, defaultModel] = await Promise.all([
      this._playgrounds.load(playgroundId),
      this._models.list(),
      this._models.getDefault(),
    ]);
    if (playground === undefined) {
      throw new Error(`Playground "${playgroundId}" was not found.`);
    }
    return {
      kind: "llm-space.thread-snapshot",
      schemaVersion: 1,
      source: {
        product: "playground",
        productId: playground.id,
        sessionId: playground.sessionId,
        lane: playground.lane,
        leafId: playground.leafId,
      },
      thread: buildSharedThread(
        playgroundToThread(playground),
        providers,
        defaultModel
      ),
    };
  }
  async publish(
    playgroundId: string,
    meta: { title?: string; description?: string } = {}
  ) {
    const snapshot = await this.read(playgroundId);
    const locator = await this._writer.writeSnapshot(
      {
        ...snapshot,
        thread: {
          ...snapshot.thread,
          ...(meta.title === undefined ? {} : { title: meta.title }),
        },
      },
      { description: meta.description }
    );
    return {
      gistId: locator.id,
      shareUrl: buildWebShareUrl(GIST_CONNECTOR_ID, locator.id),
    };
  }
  importSnapshot(snapshot: PortableThreadSnapshot) {
    const document = threadToPlaygroundDocument(snapshot.thread, {});
    return this._playgrounds.create(document);
  }
  async importGist(gistId: string) {
    return this.importSnapshot(await this._reader.readSnapshot(gistId));
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
