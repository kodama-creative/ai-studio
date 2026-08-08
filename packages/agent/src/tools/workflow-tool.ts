import { WORKFLOW_TOOL_SENTINEL_KIND } from "../shared/types";

export interface ExperimentalWorkflowToolInput {
  readonly maxSubagents?: number;
}

export interface ExperimentalWorkflowToolDefinition {
  readonly kind: typeof WORKFLOW_TOOL_SENTINEL_KIND;
  readonly maxSubagents: number;
}

export function experimentalWorkflow(
  input: ExperimentalWorkflowToolInput = {}
): ExperimentalWorkflowToolDefinition {
  const maxSubagents = input.maxSubagents ?? 100;
  if (!Number.isInteger(maxSubagents) || maxSubagents <= 0) {
    throw new TypeError("maxSubagents must be a positive integer.");
  }
  return { kind: WORKFLOW_TOOL_SENTINEL_KIND, maxSubagents };
}

export function isExperimentalWorkflowToolDefinition(
  value: unknown
): value is ExperimentalWorkflowToolDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === WORKFLOW_TOOL_SENTINEL_KIND
  );
}
