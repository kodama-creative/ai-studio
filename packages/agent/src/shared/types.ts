import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";

export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export type SchemaSource<TInput = unknown, TOutput = TInput> =
  | StandardJSONSchemaV1<TInput, TOutput>
  | StandardSchemaV1<TInput, TOutput>
  | JsonObject;

export type ValidationSchema<
  TInput = unknown,
  TOutput = TInput,
> = StandardSchemaV1<TInput, TOutput>;

export type ModuleDefinitionExport<T> = T | (() => MaybePromise<T>);

export type ExactDefinition<T, Shape> = T &
  Record<Exclude<keyof T, keyof Shape>, never>;

export const DYNAMIC_SENTINEL_KIND = "llm-space:dynamic" as const;
export const DISABLED_TOOL_SENTINEL_KIND = "llm-space:disabled-tool" as const;
export const WORKFLOW_TOOL_SENTINEL_KIND = "llm-space:workflow-tool" as const;
export const WEB_SEARCH_TOOL_SENTINEL_KIND =
  "llm-space:web-search-tool" as const;

export const TOOL_BRAND = Symbol.for("@llm-space/agent/tool");
export const SKILL_BRAND = Symbol.for("@llm-space/agent/skill");
export const INSTRUCTIONS_BRAND = Symbol.for("@llm-space/agent/instructions");
export const EXTENSION_MOUNT_BRAND = Symbol.for(
  "@llm-space/agent/mounted-extension"
);
export const CONNECTION_PROTOCOL_BRAND = Symbol.for(
  "@llm-space/agent/connection-protocol"
);

export interface DynamicResolveContext {
  readonly session: { readonly id: string; readonly auth?: unknown };
  readonly channel: {
    readonly kind?: string;
    readonly continuationToken?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly messages: readonly unknown[];
}

export type DynamicEventName =
  "session.started" | "turn.started" | "step.started";

export type DynamicEvents<TResult = unknown> = Readonly<
  Partial<
    Record<
      DynamicEventName,
      (event: unknown, context: DynamicResolveContext) => MaybePromise<TResult>
    >
  >
>;

export interface DynamicSentinel<TResult = unknown, TFallback = never> {
  readonly kind: typeof DYNAMIC_SENTINEL_KIND;
  readonly events: DynamicEvents<TResult>;
  readonly fallback?: TFallback;
  readonly build?: AgentBuildDefinition;
}

export interface AgentBuildDefinition {
  readonly externalDependencies?: string[];
}

export function defineDynamic<
  TResult = unknown,
  TFallback = never,
>(definition: {
  readonly build?: AgentBuildDefinition;
  readonly events: DynamicEvents<TResult>;
  readonly fallback?: TFallback;
}): DynamicSentinel<TResult, TFallback> {
  return {
    kind: DYNAMIC_SENTINEL_KIND,
    events: definition.events,
    ...(Object.hasOwn(definition, "fallback")
      ? { fallback: definition.fallback }
      : {}),
    ...(definition.build === undefined ? {} : { build: definition.build }),
  };
}
