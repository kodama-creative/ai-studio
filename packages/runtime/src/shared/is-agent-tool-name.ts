const AGENT_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export function isAgentToolName(value: string): boolean {
  return AGENT_TOOL_NAME_PATTERN.test(value);
}
