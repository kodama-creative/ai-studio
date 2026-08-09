import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  WindowStateSchema,
  type WindowState,
} from "@llm-space/core/server";

import type { WindowStatePersistenceStore } from "../app/window-state";

import { getFileErrorCode, writePrivateJson } from "./project-file-utils";
import type { ProjectWindowStateStore } from "./project-window-manager";

export class FileProjectWindowStateStore implements ProjectWindowStateStore {
  private readonly _path: string;

  constructor(homePath: string) {
    this._path = join(homePath, "settings", "agent-project-windows.json");
  }

  async load(): Promise<readonly string[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this._path, "utf8"));
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : [];
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      console.warn("Failed to load open agent projects:", error);
      return [];
    }
  }

  save(rootPaths: readonly string[]): Promise<void> {
    return writePrivateJson(this._path, rootPaths);
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
