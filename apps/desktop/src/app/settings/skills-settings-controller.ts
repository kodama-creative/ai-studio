import type { SkillInfo, SkillsSettings } from "@llm-space/core";
import { inject, injectable } from "inversify";

import {
  NATIVE_DIALOGS_SERVICE,
  type NativeDialogsRequests,
} from "@/shared/native-dialogs-rpc";
import {
  NATIVE_FILES_SERVICE,
  type NativeFilesRequests,
} from "@/shared/native-files-rpc";
import { SKILLS_SERVICE } from "@/shared/skills-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

const EMPTY_SETTINGS: SkillsSettings = { discoveryPaths: [] };

/** RPC-independent port used by the Skills Settings application module. */
export interface SkillsSettingsClient {
  getSettings(): Promise<SkillsSettings>;
  addPath(path: string): Promise<SkillsSettings>;
  removePath(path: string): Promise<SkillsSettings>;
  setHidden(input: {
    path: string;
    skillName: string;
    hidden: boolean;
  }): Promise<SkillsSettings>;
  setAllHidden(path: string, hidden: boolean): Promise<SkillsSettings>;
  list(path: string): Promise<SkillInfo[]>;
}

export interface SkillsSettingsSnapshot {
  readonly settings: SkillsSettings;
  readonly selectedPath: string | null;
  /** `null` means the selected path is currently loading. */
  readonly skills: readonly SkillInfo[] | null;
  readonly loadingSettings: boolean;
}

type Listener = () => void;

/** Owns Skills Settings selection, RPC ordering, and optimistic mutations. */
@injectable()
export class SkillsSettingsController {
  private readonly _client: SkillsSettingsClient;
  private readonly _dialogs: Pick<NativeDialogsRequests, "pickDirectory">;
  private readonly _files: Pick<NativeFilesRequests, "reveal">;
  private readonly _notifications: Pick<RendererNotificationService, "error">;
  private readonly _listeners = new Set<Listener>();
  private readonly _committedSkillState = new Map<string, boolean>();
  private readonly _skillRevisions = new Map<string, number>();
  private _lifecycle = 0;
  private _mutationTail = Promise.resolve();
  private _settingsRequest = 0;
  private _skillsRequest = 0;
  private _snapshot: SkillsSettingsSnapshot = {
    settings: EMPTY_SETTINGS,
    selectedPath: null,
    skills: [],
    loadingSettings: true,
  };
  private _started = false;

  constructor(
    @inject(SKILLS_SERVICE)
    client: SkillsSettingsClient,
    @inject(NATIVE_DIALOGS_SERVICE)
    dialogs: Pick<NativeDialogsRequests, "pickDirectory">,
    @inject(NATIVE_FILES_SERVICE)
    files: Pick<NativeFilesRequests, "reveal">,
    @inject(RendererNotificationService)
    notifications: Pick<RendererNotificationService, "error">
  ) {
    this._client = client;
    this._dialogs = dialogs;
    this._files = files;
    this._notifications = notifications;
  }

  readonly getSnapshot = (): SkillsSettingsSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this.stop();
    this._started = true;
    this._lifecycle += 1;
    this._set({ ...this._snapshot, loadingSettings: true });
    void this.refresh();
  }

  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    this._settingsRequest += 1;
    this._skillsRequest += 1;
  }

  async refresh(): Promise<void> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    await this._mutationTail.catch(() => undefined);
    if (!this._isCurrent(lifecycle)) return;
    const request = ++this._settingsRequest;
    this._set({ ...this._snapshot, loadingSettings: true });
    try {
      const settings = await this._client.getSettings();
      if (!this._isCurrent(lifecycle) || request !== this._settingsRequest)
        return;
      this._applySettings(settings, this._snapshot.selectedPath, true);
    } catch {
      // A load failure is non-fatal; preserve the last committed snapshot.
    } finally {
      if (this._isCurrent(lifecycle) && request === this._settingsRequest) {
        this._set({ ...this._snapshot, loadingSettings: false });
      }
    }
  }

  selectPath(path: string): void {
    this._requireStarted();
    if (
      path === this._snapshot.selectedPath ||
      !this._hasPath(this._snapshot.settings, path)
    ) {
      return;
    }
    this._set({ ...this._snapshot, selectedPath: path, skills: null });
    void this._loadSkills(path);
  }

  async addFolder(): Promise<void> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    try {
      const path = await this._dialogs.pickDirectory();
      if (!this._isCurrent(lifecycle) || path === null) return;
      await this._enqueueMutation(async () => {
        if (!this._isCurrent(lifecycle)) return;
        this._settingsRequest += 1;
        const settings = await this._client.addPath(path);
        if (!this._isCurrent(lifecycle)) return;
        this._applySettings(settings, path, true);
      });
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._notifications.error("Failed to add folder", error);
      }
    }
  }

  async removeFolder(path: string): Promise<void> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    try {
      await this._enqueueMutation(async () => {
        if (!this._isCurrent(lifecycle)) return;
        this._settingsRequest += 1;
        const settings = await this._client.removePath(path);
        if (!this._isCurrent(lifecycle)) return;
        this._applySettings(settings);
      });
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._notifications.error("Failed to remove folder", error);
      }
    }
  }

  async setAllEnabled(path: string, enabled: boolean): Promise<void> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    try {
      await this._enqueueMutation(async () => {
        if (!this._isCurrent(lifecycle)) return;
        this._settingsRequest += 1;
        const settings = await this._client.setAllHidden(path, !enabled);
        if (!this._isCurrent(lifecycle)) return;
        this._applySettings(
          settings,
          this._snapshot.selectedPath,
          this._snapshot.selectedPath === path
        );
      });
    } catch (error) {
      if (this._isCurrent(lifecycle)) {
        this._notifications.error(
          enabled ? "Failed to enable skills" : "Failed to disable skills",
          error
        );
      }
    }
  }

  async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    this._requireStarted();
    const path = this._snapshot.selectedPath;
    const skill = this._snapshot.skills?.find((item) => item.name === name);
    if (path === null || skill === undefined || skill.enabled === enabled)
      return;
    const lifecycle = this._lifecycle;
    const key = `${path}\0${name}`;
    if (!this._committedSkillState.has(key)) {
      this._committedSkillState.set(key, skill.enabled);
    }
    const revision = (this._skillRevisions.get(key) ?? 0) + 1;
    this._skillRevisions.set(key, revision);
    this._skillsRequest += 1;
    this._patchSkill(path, name, enabled);
    try {
      await this._enqueueMutation(async () => {
        if (!this._isCurrent(lifecycle)) return;
        const settings = await this._client.setHidden({
          path,
          skillName: name,
          hidden: !enabled,
        });
        if (!this._isCurrent(lifecycle)) return;
        this._committedSkillState.set(key, enabled);
        this._applySettings(settings);
      });
    } catch (error) {
      if (!this._isCurrent(lifecycle)) return;
      if (this._skillRevisions.get(key) === revision) {
        this._patchSkill(
          path,
          name,
          this._committedSkillState.get(key) ?? skill.enabled
        );
        this._notifications.error("Failed to update skill", error);
      }
    }
  }

  async revealFolder(path: string): Promise<void> {
    await this._reveal(path, "Failed to reveal folder");
  }

  async revealSkill(skill: SkillInfo): Promise<void> {
    await this._reveal(skill.path, "Failed to open skill folder");
  }

  private async _reveal(path: string, title: string): Promise<void> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    try {
      await this._files.reveal(path);
    } catch (error) {
      if (this._isCurrent(lifecycle)) this._notifications.error(title, error);
    }
  }

  private _applySettings(
    settings: SkillsSettings,
    preferredPath = this._snapshot.selectedPath,
    reloadSelected = false
  ): void {
    const selectedPath =
      preferredPath !== null && this._hasPath(settings, preferredPath)
        ? preferredPath
        : (settings.discoveryPaths[0]?.path ?? null);
    const selectionChanged = selectedPath !== this._snapshot.selectedPath;
    this._set({
      ...this._snapshot,
      settings,
      selectedPath,
      loadingSettings: false,
      ...(selectionChanged
        ? { skills: selectedPath === null ? [] : null }
        : {}),
    });
    if ((selectionChanged || reloadSelected) && selectedPath !== null) {
      void this._loadSkills(selectedPath);
    }
  }

  private async _loadSkills(path: string): Promise<void> {
    const lifecycle = this._lifecycle;
    const request = ++this._skillsRequest;
    this._set({ ...this._snapshot, skills: null });
    try {
      const skills = await this._client.list(path);
      if (
        this._isCurrent(lifecycle) &&
        request === this._skillsRequest &&
        this._snapshot.selectedPath === path
      ) {
        this._rememberCommittedSkills(path, skills);
        this._set({ ...this._snapshot, skills });
      }
    } catch {
      if (
        this._isCurrent(lifecycle) &&
        request === this._skillsRequest &&
        this._snapshot.selectedPath === path
      ) {
        this._set({ ...this._snapshot, skills: [] });
      }
    }
  }

  private _patchSkill(path: string, name: string, enabled: boolean): void {
    if (this._snapshot.selectedPath !== path || this._snapshot.skills === null)
      return;
    this._set({
      ...this._snapshot,
      skills: this._snapshot.skills.map((skill) =>
        skill.name === name ? { ...skill, enabled } : skill
      ),
    });
  }

  private _rememberCommittedSkills(
    path: string,
    skills: readonly SkillInfo[]
  ): void {
    const prefix = `${path}\0`;
    for (const key of this._committedSkillState.keys()) {
      if (key.startsWith(prefix)) this._committedSkillState.delete(key);
    }
    for (const skill of skills) {
      this._committedSkillState.set(`${path}\0${skill.name}`, skill.enabled);
    }
  }

  private _enqueueMutation(run: () => Promise<void>): Promise<void> {
    const task = this._mutationTail.catch(() => undefined).then(run);
    this._mutationTail = task.catch(() => undefined);
    return task;
  }

  private _hasPath(settings: SkillsSettings, path: string): boolean {
    return settings.discoveryPaths.some((entry) => entry.path === path);
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _set(snapshot: SkillsSettingsSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("SkillsSettingsController must be started first.");
    }
  }
}
