import {
  createContext,
  createElement,
  type ReactNode,
  useContext
} from "react";

import { getSkillsSettings, listSkills } from "@/client/skills";

import type { SkillInfo } from "@/shared/skills";

/** Return enabled local skills in stable name order for core prompt rendering. */
export async function listEnabledPromptVariableSkills(): Promise<SkillInfo[]> {
  const { discoveryPaths } = await getSkillsSettings();
  const perPath = await Promise.all(
    discoveryPaths.map(async entry =>
      listSkills(entry.path).catch((): SkillInfo[] => []))
  );
  const byName = new Map<string, SkillInfo>();
  for (const skill of perPath.flat()) {
    if (skill.enabled && !byName.has(skill.name)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type PromptSkillsLoader = () => Promise<SkillInfo[]>;

const PromptSkillsContext = createContext<PromptSkillsLoader>(
  listEnabledPromptVariableSkills
);

export function PromptSkillsProvider({
  loader,
  children
}: {
  children: ReactNode;
  loader?: PromptSkillsLoader;
}) {
  return createElement(
    PromptSkillsContext.Provider,
    { value: loader ?? listEnabledPromptVariableSkills },
    children
  );
}

export function usePromptSkillsLoader(): PromptSkillsLoader {
  return useContext(PromptSkillsContext);
}
