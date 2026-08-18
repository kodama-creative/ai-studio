import { SkillsManager } from "@llm-space/runtime/skills";
import { ContainerModule } from "inversify";

/** Bind the process-owned Skill discovery and settings authority. */
export function skillsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SkillsManager).toSelf().inSingletonScope();
  });
}
