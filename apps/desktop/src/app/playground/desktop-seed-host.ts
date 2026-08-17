import type { SeedHost } from "@llm-space/ui/components/thread-playground/examples/prompts";
import { inject, injectable } from "inversify";

import {
  APP_DIRECTORIES_SERVICE,
  type AppDirectoriesRequests,
} from "@/shared/app-directories-rpc";
import { SKILLS_SERVICE, type SkillsRequests } from "@/shared/skills-rpc";

/** Supplies prompt-example resolution from injected Desktop capabilities. */
@injectable()
export class DesktopSeedHost implements SeedHost {
  constructor(
    @inject(SKILLS_SERVICE) skills: SkillsRequests,
    @inject(APP_DIRECTORIES_SERVICE) directories: AppDirectoriesRequests
  ) {
    this.skills = {
      getSettings: () => skills.getSettings(),
      listAvailable: () => skills.listAvailable(),
      listSkills: (path) => skills.list(path),
    };
    this.paths = { ensureRootDir: (path) => directories.ensure(path) };
  }

  readonly skills: SeedHost["skills"];
  readonly paths: SeedHost["paths"];
}
