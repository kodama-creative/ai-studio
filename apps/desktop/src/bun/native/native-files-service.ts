import { userDirectoryExists } from "@llm-space/core/server";
import { SkillsManager } from "@llm-space/runtime/skills";
import { inject, injectable } from "inversify";

import { openPath, revealInFileManager } from "../fs";
import { revealResource } from "../fs/reveal-resource";

/** Process-owned access to the operating system's native file presentation. */
@injectable()
export class NativeFilesService {
  constructor(
    @inject(SkillsManager) private readonly _skills: SkillsManager
  ) {}

  /** Return whether a user-supplied directory exists. */
  directoryExists(path: string): Promise<boolean> {
    return userDirectoryExists(path);
  }

  /** Resolve an absolute path or supported locator and reveal its resource. */
  revealResource(pathOrLocator: string): Promise<void> {
    return revealResource(pathOrLocator, { skillsManager: this._skills });
  }

  /** Open a file with the operating system's default application. */
  openWithDefaultApplication(path: string): void {
    openPath(path);
  }

  /** Reveal a file or directory in the operating system's file manager. */
  revealInFileManager(path: string): Promise<void> {
    return revealInFileManager(path);
  }
}
