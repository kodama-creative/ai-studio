import type { Static, TSchema } from "typebox";

const TOOL_DEFINITION_BRAND = Symbol.for("llm-space.tool-definition");

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ToolContext {
  readonly abortSignal: AbortSignal;
  readonly callId: string;
  readonly toolName: string;
}

export interface ToolDefinition<
  TInputSchema extends TSchema = TSchema,
  TOutput extends JsonValue = JsonValue,
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
  TOutput extends JsonValue,
> = Omit<ToolDefinition<TInputSchema, TOutput>, typeof TOOL_DEFINITION_BRAND> & {
  readonly name?: never;
  readonly label?: never;
};

export function defineTool<
  TInputSchema extends TSchema,
  TOutput extends JsonValue,
>(
  definition: ToolDefinitionInput<TInputSchema, TOutput>
): ToolDefinition<TInputSchema, TOutput> {
  return Object.defineProperty(definition, TOOL_DEFINITION_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as ToolDefinition<TInputSchema, TOutput>;
}

export function isToolDefinition(value: unknown): value is ToolDefinition {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<ToolDefinition>)[TOOL_DEFINITION_BRAND] === true
  );
}
