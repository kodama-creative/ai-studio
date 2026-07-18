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
  }
): PreparedAgentTool {
  const { execute, ...definition } = tool;
  return {
    kind: "executable",
    definition,
    provenance,
    async execute(...args) {
      return { type: "completed", result: await execute(...args) };
    }
  };
}
