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
  readonly runtimeId: string;
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
 * Bind every runtime-sensitive project-generation capability to one immutable
 * owner. The generated project still writes to the local directory selected by
 * the user, but all model/config/credential reads come from this runtime.
 */
export function bindProjectGenerationRuntime({
  runtimeId,
  auxiliaryGeneration,
  profileId,
  skills,
  mcp,
  generator,
}: {
  runtimeId: string;
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
    runtimeId,
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
    listEnabledSkills: () =>
      listEnabledPromptVariableSkills(skills, { runtimeId }),
    listMcpServers: () => mcp.listServers({ runtimeId }),
    getSearchSettings: () => generator.getSearchSettings({ runtimeId }),
    resolveEnv: (providerId, envNames, profileId) =>
      generator.resolveEnv(providerId, envNames, { runtimeId, profileId }),
  };
}
