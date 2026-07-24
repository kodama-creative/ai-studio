import type { Approval } from "./approval";

const EXECUTION_ENV_TOOL_DEFINITION_BRAND = Symbol.for(
  "llm-space.execution-env-tool-definition"
);

export type ExecutionEnvToolKind = "bash" | "read" | "write";

export interface ExecutionEnvToolDefinition<
  TKind extends ExecutionEnvToolKind = ExecutionEnvToolKind
> {
  readonly approval?: Approval;
  readonly kind: TKind;
  readonly [EXECUTION_ENV_TOOL_DEFINITION_BRAND]?: true;
}

export interface ExecutionEnvToolOptions {
  readonly approval?: Approval;
}

export function isExecutionEnvToolDefinition(
  value: unknown
): value is ExecutionEnvToolDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Partial<ExecutionEnvToolDefinition>)[
      EXECUTION_ENV_TOOL_DEFINITION_BRAND
    ] === true
    && (
      (value as Partial<ExecutionEnvToolDefinition>).kind === "bash"
      || (value as Partial<ExecutionEnvToolDefinition>).kind === "read"
      || (value as Partial<ExecutionEnvToolDefinition>).kind === "write"
    )
  );
}
