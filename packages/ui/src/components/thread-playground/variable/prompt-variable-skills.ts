import type { SkillInfo } from "@llm-space/core";

import type { SkillsHost } from "../../../host";

/** Return enabled local skills in stable name order for core prompt rendering. */
export async function listEnabledPromptVariableSkills(
  skills: SkillsHost
): Promise<SkillInfo[]> {
  const available = await skills.listAvailable();
  const byName = new Map<string, SkillInfo>();
  for (const skill of available) {
    if (skill.enabled && !byName.has(skill.name)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
