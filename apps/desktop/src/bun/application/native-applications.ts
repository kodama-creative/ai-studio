import { userDirectoryExists } from "@llm-space/core/server";
import type { SkillsManager } from "@llm-space/runtime/skills";
import { Utils, type BrowserWindow } from "electrobun/bun";

import type { DesktopWindowContext } from "../../shared/agent-project";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import { ensureRootDir } from "../fs/ensure-root-dir";
import { revealResource } from "../fs/reveal-resource";

export interface WindowApplicationApi {
  getContext(): Promise<DesktopWindowContext>;
  toggleMaximized(): Promise<{ maximized: boolean }>;
  getFullscreenState(): Promise<{ fullScreen: boolean }>;
}
export interface NativeDialogsApplication {
  pickFile(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
}
export interface NativeFilesApplication {
  directoryExists(path: string): Promise<boolean>;
  reveal(pathOrLocator: string): Promise<void>;
}
export interface AppDirectoriesApplicationApi {
  ensure(relativePath: string): Promise<string>;
}
export interface WindowApplicationEvents {
  fullScreenChanged: { fullScreen: boolean };
}

export class WindowApplication implements WindowApplicationApi, Disposable {
  readonly events = new EventHub<WindowApplicationEvents>();
  constructor(
    private readonly _window: () => BrowserWindow,
    private readonly _context: DesktopWindowContext
  ) {}
  getContext() {
    return Promise.resolve(this._context);
  }
  toggleMaximized() {
    const window = this._window();
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return Promise.resolve({ maximized: window.isMaximized() });
  }
  getFullscreenState() {
    return Promise.resolve({ fullScreen: this._window().isFullScreen() });
  }
  /** Publish a native fullscreen transition to the owning renderer. */
  notifyFullScreenChanged(fullScreen: boolean): void {
    this.events.publish("fullScreenChanged", { fullScreen });
  }
  /** Release listeners owned by this native window. */
  dispose(): void {
    this.events.dispose();
  }
}

export class NativeDialogApplication implements NativeDialogsApplication {
  async pickFile() {
    return this._pick(false);
  }
  async pickDirectory() {
    return this._pick(true);
  }
  private async _pick(directory: boolean): Promise<string | null> {
    const selected = await Utils.openFileDialog({
      startingFolder: "~/",
      canChooseFiles: !directory,
      canChooseDirectory: directory,
      allowsMultipleSelection: false,
    });
    return selected.map((value) => value.trim()).find(Boolean) ?? null;
  }
}

export class NativeFileApplication implements NativeFilesApplication {
  constructor(private readonly _skills: Pick<SkillsManager, "findSkill">) {}
  directoryExists(path: string) {
    return userDirectoryExists(path);
  }
  reveal(pathOrLocator: string) {
    return revealResource(pathOrLocator, { skillsManager: this._skills });
  }
}

export class AppDirectoriesApplication implements AppDirectoriesApplicationApi {
  constructor(private readonly _homePath: string) {}
  ensure(relativePath: string) {
    return Promise.resolve(ensureRootDir(this._homePath, relativePath));
  }
}
