export const AGENT_PROJECT_PRESETS = [
  "local-tool",
  "skill",
  "mcp-connection"
] as const;

export type AgentProjectPreset = typeof AGENT_PROJECT_PRESETS[number];

export const DEFAULT_AGENT_PROJECT_PRESETS = [
  "local-tool",
  "skill"
] as const satisfies readonly AgentProjectPreset[];

export interface AgentProjectMcpConnectionPreset {
  readonly tools: readonly string[];
  readonly url: string;
}

export interface AgentProjectScaffoldConfig {
  readonly mcpConnection?: AgentProjectMcpConnectionPreset;
  readonly presets: readonly AgentProjectPreset[];
}

const AGENT_PROJECT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AGENT_PROJECT_MCP_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export function isAgentProjectName(value: string): boolean {
  return AGENT_PROJECT_NAME_PATTERN.test(value);
}

export function isAgentProjectPreset(
  value: string
): value is AgentProjectPreset {
  return (AGENT_PROJECT_PRESETS as readonly string[]).includes(value);
}

export function isAgentProjectMcpToolName(value: string): boolean {
  return AGENT_PROJECT_MCP_TOOL_NAME_PATTERN.test(value);
}

export function isAgentProjectMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}
