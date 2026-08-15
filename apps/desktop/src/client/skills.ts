import type { SkillContent, SkillInfo, SkillsSettings } from "@llm-space/core";

import { createRpcClient } from "@/shared/namespaced-rpc";
import { SKILLS_RPC } from "@/shared/skills-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";
import { pickNativeDirectory } from "./native-files";

const skillsClient = createRpcClient(
  SKILLS_RPC,
  createElectrobunRpcClientTransport()
);

export async function getSkillsSettings(): Promise<SkillsSettings> {
  return skillsClient.getSettings();
}

/** Open the native folder picker; resolves to the chosen path or `null`. */
export async function browseForSkillsPath(): Promise<string | null> {
  return pickNativeDirectory();
}

export async function addSkillsPath(
  path: string
): Promise<SkillsSettings> {
  return skillsClient.addPath(path);
}

export async function removeSkillsPath(
  path: string
): Promise<SkillsSettings> {
  return skillsClient.removePath(path);
}

export async function setSkillHidden(
  path: string,
  skillName: string,
  hidden: boolean
): Promise<SkillsSettings> {
  return skillsClient.setHidden({ path, skillName, hidden });
}

export async function setAllSkillsHidden(
  path: string,
  hidden: boolean
): Promise<SkillsSettings> {
  return skillsClient.setAllHidden(path, hidden);
}

export async function listSkills(path: string): Promise<SkillInfo[]> {
  return skillsClient.list(path);
}

export async function listAvailableSkills(): Promise<SkillInfo[]> {
  return skillsClient.listAvailable();
}

export async function readSkill(path: string): Promise<SkillContent> {
  return skillsClient.read(path);
}
