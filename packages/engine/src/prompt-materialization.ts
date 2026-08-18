import type { SkillInfo, ThreadContext } from "@llm-space/core";
import { renderThreadPromptVariables } from "@llm-space/core/thread";

export interface DocumentPromptServices {
  loadSkills(): Promise<SkillInfo[]>;
  loadFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
}

const DEFAULT_SERVICES: DocumentPromptServices = {
  loadSkills: () => Promise.resolve([]),
  loadFile: () => Promise.resolve(""),
  fileExists: () => Promise.resolve(false),
};

/**
 * Materializes the exact provider-facing prompt in Engine, never in a UI.
 * Hosts supply filesystem and Skill capabilities; pure callers get no-op
 * services and therefore cannot accidentally access host state.
 */
export function materializeDocumentPrompt(
  context: ThreadContext,
  services: DocumentPromptServices = DEFAULT_SERVICES
): ReturnType<typeof renderThreadPromptVariables> {
  return renderThreadPromptVariables({
    context,
    loadSkills: () => services.loadSkills(),
    loadFile: (path) => services.loadFile(path),
    fileExists: (path) => services.fileExists(path),
  });
}
