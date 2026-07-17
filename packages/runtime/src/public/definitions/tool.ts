import type { Static, TSchema } from "typebox";

import { defineToolRuntime } from "../../internal/authored-action-definitions";

import type { AgentSessionContext } from "../../shared/agent-session-context";

const TOOL_DEFINITION_BRAND = Symbol.for("llm-space.tool-definition");

export type JsonValue =
  | { [key: string]: JsonValue; }
  | boolean
  | JsonValue[]
  | number
  | string
  | null;

export interface ToolContext {
  readonly abortSignal: AbortSignal;
  readonly callId: string;
  readonly session: AgentSessionContext;
  readonly toolName: string;
}

export interface ToolDefinition<
  TInputSchema extends TSchema = TSchema,
  TOutput extends JsonValue = JsonValue
> {
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema?: TSchema;
  readonly execute: (
    input: Static<TInputSchema>,
    context: ToolContext
  ) => Promise<TOutput> | TOutput;
  readonly [TOOL_DEFINITION_BRAND]: true;
}

type ToolDefinitionInput<
  TInputSchema extends TSchema,
  TOutput extends JsonValue
> = {
  readonly label?: never;
  readonly name?: never;
} & Omit<ToolDefinition<TInputSchema, TOutput>, typeof TOOL_DEFINITION_BRAND>;

export function defineTool<
  TInputSchema extends TSchema,
  TOutput extends JsonValue
>(
  definition: ToolDefinitionInput<TInputSchema, TOutput>
): ToolDefinition<TInputSchema, TOutput> {
  return defineToolRuntime(definition) as ToolDefinition<
    TInputSchema,
    TOutput
  >;
}

export function isToolDefinition(value: unknown): value is ToolDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Partial<ToolDefinition>)[TOOL_DEFINITION_BRAND] === true
  );
}
