import type { SkillService } from "@llm-space/agent/runtime";
import type { SkillsManager } from "@llm-space/runtime/skills";
import { inject, injectable } from "inversify";

import { SKILLS_MANAGER } from "../skills/skills-module";

/** Resolves Agent-mounted Skills through the process-owned discovery manager. */
@injectable()
export class ProjectSkillService implements SkillService {
  constructor(
    @inject(SKILLS_MANAGER) private readonly _skills: SkillsManager
  ) {}

  /** Return one validated Skill handle for an admitted Project operation. */
  resolve({ identifier }: Parameters<SkillService["resolve"]>[0]) {
    const skill = this._skills.findSkill(identifier);
    if (skill === null) {
      throw new Error(`Skill "${identifier}" is not available.`);
    }
    const name = skill.frontmatters.name;
    const description = skill.frontmatters.description;
    if (typeof name !== "string" || typeof description !== "string") {
      throw new Error(`Skill "${identifier}" has invalid frontmatter.`);
    }
    return { name, description, markdown: skill.content };
  }
}
