import type { SkillContent, SkillInfo, SkillsSettings } from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { pickNativeDirectory } from "./native-files";
import { skillsClient } from "./runtime-rpc-clients";

export async function getSkillsSettings(
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.getSettings(runtimeId);
}

/** Open the native folder picker; resolves to the chosen path or `null`. */
export async function browseForSkillsPath(): Promise<string | null> {
  return pickNativeDirectory();
}

export async function addSkillsPath(
  path: string,
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.addPath(runtimeId, path);
}

export async function removeSkillsPath(
  path: string,
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.removePath(runtimeId, path);
}

export async function setSkillHidden(
  path: string,
  skillName: string,
  hidden: boolean,
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.setHidden(runtimeId, { path, skillName, hidden });
}

export async function setPluginSkillHidden(
  pluginId: string,
  skillName: string,
  hidden: boolean,
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.setPluginHidden(runtimeId, { pluginId, skillName, hidden });
}

export async function setAllPluginSkillsHidden(
  pluginId: string,
  hidden: boolean,
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.setAllPluginHidden(runtimeId, pluginId, hidden);
}

export async function setAllSkillsHidden(
  path: string,
  hidden: boolean,
  runtimeId?: RuntimeId
): Promise<SkillsSettings> {
  return skillsClient.setAllHidden(runtimeId, path, hidden);
}

export async function listSkills(
  path: string,
  runtimeId?: RuntimeId
): Promise<SkillInfo[]> {
  return skillsClient.list(runtimeId, path);
}

export async function listAvailableSkills(
  runtimeId?: RuntimeId
): Promise<SkillInfo[]> {
  return skillsClient.listAvailable(runtimeId);
}

export async function listPluginSkills(
  runtimeId?: RuntimeId
): Promise<SkillInfo[]> {
  return skillsClient.listPlugin(runtimeId);
}

export async function readSkill(
  path: string,
  runtimeId?: RuntimeId
): Promise<SkillContent> {
  return skillsClient.read(runtimeId, path);
}
