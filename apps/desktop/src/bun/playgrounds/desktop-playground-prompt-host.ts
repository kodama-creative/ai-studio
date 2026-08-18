import { readUserTextFile, userTextFileExists } from "@llm-space/core/server";
import { SkillsManager } from "@llm-space/runtime/skills";
import { inject, injectable } from "inversify";

import type { PlaygroundPromptHost } from "./playground-application";

/** Supplies Engine prompt materialization with process-owned host capabilities. */
@injectable()
export class DesktopPlaygroundPromptHost implements PlaygroundPromptHost {
  constructor(@inject(SkillsManager) private readonly _skills: SkillsManager) {}

  loadSkills() {
    return Promise.resolve(this._skills.listAvailableSkills());
  }

  loadFile(path: string) {
    return readUserTextFile(path);
  }

  fileExists(path: string) {
    return userTextFileExists(path);
  }
}
