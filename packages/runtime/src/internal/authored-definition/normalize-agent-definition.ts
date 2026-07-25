import { isDynamicModelDefinition } from "../authored-dynamic-model-definition";

import type {
  AgentDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentReasoningDefinition
} from "../../public/definitions/agent";

const AGENT_DEFINITION_KEYS = new Set([
  "environment",
  "limits",
  "model",
  "modelOptions",
  "reasoning"
]);
const MODEL_OPTION_KEYS = new Set([
  "cacheRetention",
  "maxRetryDelayMs",
  "maxRetries",
  "maxTokens",
  "reasoning",
  "temperature",
  "thinkingBudgets",
  "timeoutMs",
  "transport",
  "websocketConnectTimeoutMs"
]);
const ENVIRONMENT_REQUIREMENT_KEYS = new Set([
  "description",
  "kind",
  "required"
]);
const SESSION_LIMIT_KEYS = new Set([
  "maxInputTokensPerSession",
  "maxOutputTokensPerSession"
]);
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
  if (
    typeof candidate.model !== "string"
    && !isDynamicModelDefinition(candidate.model)
  ) {
    throw new TypeError(errorMessage);
  }
  const fallback = typeof candidate.model === "string"
    ? candidate.model
    : candidate.model.fallback;
  const separator = fallback.indexOf("/");
  if (separator <= 0 || separator === fallback.length - 1) {
    throw new TypeError(errorMessage);
  }
  if (
    candidate.reasoning !== undefined
    && !AGENT_REASONING_VALUES.has(candidate.reasoning)
  ) {
    throw new TypeError(errorMessage);
  }
  const environment = _normalizeEnvironment(candidate.environment, errorMessage);
  const limits = _normalizeSessionLimits(candidate.limits, errorMessage);
  const modelOptions = _normalizeModelOptions(
    candidate.modelOptions,
    errorMessage
  );
  return {
    model: candidate.model,
    ...(limits ? { limits } : {}),
    ...(modelOptions ? { modelOptions } : {}),
    ...(candidate.reasoning ? { reasoning: candidate.reasoning } : {}),
    ...(environment ? { environment } : {})
  };
}

function _normalizeSessionLimits(
  value: unknown,
  errorMessage: string
): AgentDefinition["limits"] {
  if (value === undefined) { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(errorMessage);
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(key => !SESSION_LIMIT_KEYS.has(key))
    || Object.values(candidate).some(limit =>
      limit !== false
      && (!Number.isSafeInteger(limit) || (limit as number) <= 0))
  ) {
    throw new TypeError(errorMessage);
  }
  return { ...candidate };
}

function _normalizeModelOptions(
  value: unknown,
  errorMessage: string
): AgentDefinition["modelOptions"] {
  if (value === undefined) { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(errorMessage);
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some(key => !MODEL_OPTION_KEYS.has(key))) {
    throw new TypeError(errorMessage);
  }
  return { ...candidate };
}

function _normalizeEnvironment(
  value: unknown,
  errorMessage: string
): AgentEnvironmentRequirements | undefined {
  if (value === undefined) { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(errorMessage);
  }
  const environment: Record<string, AgentEnvironmentRequirement> = {};
  for (const name of Object.keys(value).sort(_compareCodePoint)) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new TypeError(errorMessage);
    }
    const requirement = (value as Record<string, unknown>)[name];
    if (
      !requirement
      || typeof requirement !== "object"
      || Array.isArray(requirement)
    ) {
      throw new TypeError(errorMessage);
    }
    const candidate = requirement as Record<string, unknown>;
    if (
      Object.keys(candidate).some(key => !ENVIRONMENT_REQUIREMENT_KEYS.has(key))
      || (candidate.kind !== "config" && candidate.kind !== "secret")
      || typeof candidate.required !== "boolean"
      || (
        candidate.description !== undefined
        && (
          typeof candidate.description !== "string"
          || candidate.description.trim().length === 0
        )
      )
    ) {
      throw new TypeError(errorMessage);
    }
    environment[name] = {
      kind: candidate.kind,
      required: candidate.required,
      ...(typeof candidate.description === "string"
        ? { description: candidate.description }
        : {})
    };
  }
  return environment;
}

function _compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
