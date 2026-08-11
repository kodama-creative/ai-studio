import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";

import type { TokenResult } from "../connections/authorization";
import type { SandboxSession } from "../sandbox";
import {
  TOOL_BRAND,
  type JsonObject,
  type SchemaSource,
} from "../shared/types";
import type { SkillHandle } from "../skills";

import type { Approval } from "./approval";
import type { ToolModelOutput } from "./output";

export interface ExecutionContext {
  readonly execution: {
    readonly threadId: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly callId: string;
    readonly toolName: string;
  };
  getSandbox(): Promise<SandboxSession>;
  getSkill(identifier: string): SkillHandle;
}

export type ToolAuthProvider = unknown;
export interface ToolAuthOptions {
  readonly authKey?: string;
  readonly connection?: unknown;
  readonly displayName?: string;
}

export interface ToolContext extends ExecutionContext {
  readonly abortSignal: AbortSignal;
  getToken(
    provider: ToolAuthProvider,
    options?: ToolAuthOptions
  ): Promise<TokenResult>;
  requireAuth(provider: ToolAuthProvider, options?: ToolAuthOptions): never;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly description: string;
  readonly inputSchema: SchemaSource<unknown, TInput>;
  readonly outputSchema?: SchemaSource<unknown, TOutput>;
  execute(
    input: TInput,
    context: ToolContext
  ): TOutput | Promise<TOutput> | AsyncIterable<TOutput>;
  readonly approval?: Approval<TInput>;
  readonly toModelOutput?: (
    output: TOutput
  ) => ToolModelOutput | Promise<ToolModelOutput>;
}

type ExecuteOutput<TReturn> =
  TReturn extends Promise<infer TOutput>
    ? TOutput
    : TReturn extends AsyncIterable<infer TOutput>
      ? TOutput
      : TReturn;
type InferSchemaOutput<TSchema> = TSchema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TSchema>
  : Record<string, unknown>;

export function defineTool<
  TInputSchema extends StandardSchemaV1,
  TReturn,
>(definition: {
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema?: SchemaSource;
  execute(
    input: InferSchemaOutput<TInputSchema>,
    context: ToolContext
  ): TReturn;
  readonly approval?: Approval<InferSchemaOutput<TInputSchema>>;
  readonly toModelOutput?: (
    output: ExecuteOutput<TReturn>
  ) => ToolModelOutput | Promise<ToolModelOutput>;
}): ToolDefinition<InferSchemaOutput<TInputSchema>, ExecuteOutput<TReturn>>;
export function defineTool<TReturn>(definition: {
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: SchemaSource;
  execute(input: Record<string, unknown>, context: ToolContext): TReturn;
  readonly approval?: Approval<Record<string, unknown>>;
  readonly toModelOutput?: (
    output: ExecuteOutput<TReturn>
  ) => ToolModelOutput | Promise<ToolModelOutput>;
}): ToolDefinition<Record<string, unknown>, ExecuteOutput<TReturn>>;
export function defineTool<TInput = unknown, TOutput = unknown>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput>;
export function defineTool<TInput = unknown, TOutput = unknown>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  if ((definition as { auth?: unknown }).auth !== undefined) {
    throw new Error(
      'defineTool: The "auth" field is not supported. Resolve credentials through ToolContext.'
    );
  }
  Object.defineProperty(definition, TOOL_BRAND, { value: true });
  return definition;
}

export type { StandardJSONSchemaV1 };
