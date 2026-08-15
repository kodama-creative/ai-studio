import type {
  McpServerView,
  SearchSettings,
  SkillInfo,
} from "@llm-space/core";
import { uuid } from "@llm-space/core";
import type { OneShotRunner } from "@llm-space/core/workflow";

import type { HostServices, McpHost, SkillsHost } from "@llm-space/ui/host";

import { listEnabledPromptVariableSkills } from "../variable/prompt-variable-skills";

type GeneratorHost = NonNullable<HostServices["generator"]>;

export interface ProjectGenerationRuntime {
  readonly runOneShot: OneShotRunner;
  listEnabledSkills(): Promise<SkillInfo[]>;
  listMcpServers(): Promise<McpServerView[]>;
  getSearchSettings(): Promise<SearchSettings>;
  resolveEnv(
    providerId: string,
    envNames: string[],
    profileId?: string
  ): Promise<{ modelApiKey: string; envValues: Record<string, string> }>;
}

/**
 * Bind project-generation capabilities to the injected host services.
 */
export function bindProjectGenerationRuntime({
  auxiliaryGeneration,
  profileId,
  skills,
  mcp,
  generator,
}: {
  auxiliaryGeneration: HostServices["auxiliaryGeneration"];
  profileId?: string;
  skills: SkillsHost;
  mcp: McpHost;
  generator: GeneratorHost;
}): ProjectGenerationRuntime | null {
  if (!auxiliaryGeneration) {
    return null;
  }

  return {
    runOneShot: async ({ systemPrompt, userPrompt, model, signal }) => {
      let text = "";
      for await (const event of auxiliaryGeneration.generate({
        systemPrompt: systemPrompt ?? "",
        messages: [
          {
            id: uuid(),
            role: "user",
            content: [{ type: "text", text: userPrompt }],
          },
        ],
        model,
        ...(profileId ? { profileId } : {}),
        signal,
      })) {
        text = event.type === "text.delta" ? text + event.delta : event.text;
      }
      return text;
    },
    listEnabledSkills: () => listEnabledPromptVariableSkills(skills),
    listMcpServers: () => mcp.listServers(),
    getSearchSettings: () => generator.getSearchSettings(),
    resolveEnv: (providerId, envNames, profileId) =>
      generator.resolveEnv(providerId, envNames, { profileId }),
  };
}
