import type {
  AgentDefinition,
  AgentReasoningDefinition
} from "../../public/definitions/agent";

const AGENT_DEFINITION_KEYS = new Set(["model", "reasoning"]);
const AGENT_REASONING_VALUES = new Set<AgentReasoningDefinition>([
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);

export function normalizeAgentDefinition(
  value: unknown,
  errorMessage: string
): AgentDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(errorMessage);
  }
  const candidate = value as Partial<AgentDefinition> & Record<string, unknown>;
  if (Object.keys(candidate).some(key => !AGENT_DEFINITION_KEYS.has(key))) {
    throw new TypeError(errorMessage);
  }
  if (typeof candidate.model !== "string") {
    throw new TypeError(errorMessage);
  }
  const separator = candidate.model.indexOf("/");
  if (separator <= 0 || separator === candidate.model.length - 1) {
    throw new TypeError(errorMessage);
  }
  if (
    candidate.reasoning !== undefined
    && !AGENT_REASONING_VALUES.has(candidate.reasoning)
  ) {
    throw new TypeError(errorMessage);
  }
  return candidate as unknown as AgentDefinition;
}
