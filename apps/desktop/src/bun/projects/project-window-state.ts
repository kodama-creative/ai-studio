import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { WindowStateSchema, type WindowState } from "@llm-space/core/server";
import { inject, injectable } from "inversify";

import type { WindowStatePersistenceStore } from "../app/window-state";
import { APP_HOME_PATH } from "../native/app-directories-module";

import { getFileErrorCode, writePrivateJson } from "./project-file-utils";
import type {
  AgentProjectCatalogStore,
  ProjectWindowStateStore,
} from "./project-window-manager";

class FilePathListStore {
  constructor(private readonly _path: string) {}

  async load(): Promise<readonly string[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this._path, "utf8"));
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? value
        : [];
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      console.warn(`Failed to load path list "${this._path}":`, error);
      return [];
    }
  }

  save(rootPaths: readonly string[]): Promise<void> {
    return writePrivateJson(this._path, rootPaths);
  }
}

@injectable()
export class FileProjectWindowStateStore implements ProjectWindowStateStore {
  private readonly _store: FilePathListStore;

  constructor(@inject(APP_HOME_PATH) homePath: string) {
    this._store = new FilePathListStore(
      join(homePath, "settings", "agent-project-windows.json")
    );
  }

  load(): Promise<readonly string[]> {
    return this._store.load();
  }

  save(rootPaths: readonly string[]): Promise<void> {
    return this._store.save(rootPaths);
  }
}

/** Durable Project catalog shown in the default main window. */
@injectable()
export class FileAgentProjectCatalogStore implements AgentProjectCatalogStore {
  private readonly _store: FilePathListStore;

  constructor(@inject(APP_HOME_PATH) homePath: string) {
    this._store = new FilePathListStore(
      join(homePath, "settings", "agent-projects.json")
    );
  }

  load(): Promise<readonly string[]> {
    return this._store.load();
  }

  save(rootPaths: readonly string[]): Promise<void> {
    return this._store.save(rootPaths);
  }
}

export class ProjectWindowStateFile implements WindowStatePersistenceStore {
  private _state: WindowState;
  private _writeQueue = Promise.resolve();

  private constructor(
    private readonly _path: string,
    initial: WindowState
  ) {
    this._state = initial;
  }

  static async load(homePath: string, projectId: string) {
    const path = join(
      homePath,
      "settings",
      "project-windows",
      `${projectId}.json`
    );
    let state: WindowState = {};
    try {
      state = WindowStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (getFileErrorCode(error) !== "ENOENT") {
        console.warn(`Failed to load project window state "${path}":`, error);
      }
    }
    return new ProjectWindowStateFile(path, state);
  }

  get state(): WindowState {
    return this._state;
  }

  update(patch: Partial<WindowState>): Promise<void> {
    this._state = WindowStateSchema.parse({ ...this._state, ...patch });
    const snapshot = this._state;
    const write = this._writeQueue
      .catch(() => undefined)
      .then(() => writePrivateJson(this._path, snapshot));
    this._writeQueue = write;
    return write;
  }

  flush(): Promise<void> {
    return this._writeQueue;
  }
}
