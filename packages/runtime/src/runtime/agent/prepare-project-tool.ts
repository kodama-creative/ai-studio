import type { ExecutionEnv } from "@earendil-works/pi-agent-core";

import { createExecutionEnvTool } from "../execution-env/create-execution-env-tool";

import type { CompiledProjectTool } from "./agent-project-snapshot";
import type {
  PreparedAgentTool,
  PreparedAgentToolProvenance
} from "./prepared-agent-tool";

export function prepareProjectTool(
  tool: CompiledProjectTool,
  provenance: PreparedAgentToolProvenance = {
    contributionId: `tool:${tool.sourcePath ?? tool.name}`,
    ...(tool.sourcePath ? { sourcePath: tool.sourcePath } : {})
  },
  executionEnv?: ExecutionEnv
): PreparedAgentTool {
  if (tool.executionEnvToolKind) {
    const prepared = createExecutionEnvTool({ env: executionEnv, tool });
    return { ...prepared, provenance };
  }
  const { approval, execute, ...definition } = tool;
  return {
    ...(approval ? { approval } : {}),
    kind: "executable",
    definition,
    provenance,
    async execute(...args) {
      return { type: "completed", result: await execute(...args) };
    }
  };
}
