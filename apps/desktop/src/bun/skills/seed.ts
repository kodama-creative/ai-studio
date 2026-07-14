import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getLlmSpaceHomePath } from "@llm-space/core/server";

/**
 * Bundle the built-in skill text with the Bun process.
 */
import deepResearchSkill from "../../components/thread-playground/examples/deep-research-skill.md" with { type: "text" };

/**
 * Return the managed skills directory.
 */
export function getManagedSkillsDir(): string {
  return path.join(getLlmSpaceHomePath(), "skills");
}

/**
 * Seed the built-in skill when the managed directory does not exist.
 */
export function seedSkills(): void {
  const skillsDir = getManagedSkillsDir();
  if (existsSync(skillsDir)) {
    return;
  }
  const deepResearchDir = path.join(skillsDir, "deep-research");
  mkdirSync(deepResearchDir, { recursive: true });
  writeFileSync(
    path.join(deepResearchDir, "SKILL.md"),
    deepResearchSkill,
    "utf8"
  );
}
