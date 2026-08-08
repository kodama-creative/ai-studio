import type { ExactDefinition, MaybePromise } from "../shared/types";

export interface HookEventMap {
  readonly "action.partial": {
    readonly type: "action.partial";
    readonly data?: unknown;
  };
  readonly "action.result": {
    readonly type: "action.result";
    readonly data?: unknown;
  };
  readonly "actions.requested": {
    readonly type: "actions.requested";
    readonly data?: unknown;
  };
  readonly "authorization.completed": {
    readonly type: "authorization.completed";
    readonly data?: unknown;
  };
  readonly "authorization.required": {
    readonly type: "authorization.required";
    readonly data?: unknown;
  };
  readonly "compaction.completed": {
    readonly type: "compaction.completed";
    readonly data?: unknown;
  };
  readonly "compaction.requested": {
    readonly type: "compaction.requested";
    readonly data?: unknown;
  };
  readonly "context.cleared": {
    readonly type: "context.cleared";
    readonly data?: unknown;
  };
  readonly "input.requested": {
    readonly type: "input.requested";
    readonly data?: unknown;
  };
  readonly "message.appended": {
    readonly type: "message.appended";
    readonly data?: unknown;
  };
  readonly "message.completed": {
    readonly type: "message.completed";
    readonly data?: unknown;
  };
  readonly "message.received": {
    readonly type: "message.received";
    readonly data?: unknown;
  };
  readonly "reasoning.appended": {
    readonly type: "reasoning.appended";
    readonly data?: unknown;
  };
  readonly "reasoning.completed": {
    readonly type: "reasoning.completed";
    readonly data?: unknown;
  };
  readonly "result.completed": {
    readonly type: "result.completed";
    readonly data?: unknown;
  };
  readonly "session.completed": {
    readonly type: "session.completed";
    readonly data?: unknown;
  };
  readonly "session.failed": {
    readonly type: "session.failed";
    readonly data?: unknown;
  };
  readonly "session.started": {
    readonly type: "session.started";
    readonly data?: unknown;
  };
  readonly "session.waiting": {
    readonly type: "session.waiting";
    readonly data?: unknown;
  };
  readonly "step.completed": {
    readonly type: "step.completed";
    readonly data?: unknown;
  };
  readonly "step.failed": {
    readonly type: "step.failed";
    readonly data?: unknown;
  };
  readonly "step.started": {
    readonly type: "step.started";
    readonly data?: unknown;
  };
  readonly "subagent.called": {
    readonly type: "subagent.called";
    readonly data?: unknown;
  };
  readonly "subagent.completed": {
    readonly type: "subagent.completed";
    readonly data?: unknown;
  };
  readonly "subagent.event": {
    readonly type: "subagent.event";
    readonly data?: unknown;
  };
  readonly "subagent.started": {
    readonly type: "subagent.started";
    readonly data?: unknown;
  };
  readonly "turn.cancelled": {
    readonly type: "turn.cancelled";
    readonly data?: unknown;
  };
  readonly "turn.completed": {
    readonly type: "turn.completed";
    readonly data?: unknown;
  };
  readonly "turn.failed": {
    readonly type: "turn.failed";
    readonly data?: unknown;
  };
  readonly "turn.started": {
    readonly type: "turn.started";
    readonly data?: unknown;
  };
}

export type HookEventType = keyof HookEventMap;
export type HookEventKey = HookEventType | "*";
export type HookEvent<TKey extends HookEventKey = HookEventType> =
  TKey extends HookEventType ? HookEventMap[TKey] : HookEventMap[HookEventType];

export interface HookContext {
  readonly session: {
    readonly id: string;
    readonly auth: unknown;
    readonly turn: unknown;
    readonly parent?: unknown;
  };
  readonly agent: { readonly name: string; readonly nodeId?: string };
  readonly channel: {
    readonly kind?: string;
    readonly continuationToken?: string;
  };
  getSandbox(): Promise<unknown>;
  getSkill(identifier: string): unknown;
}

export type StreamEventHook<TEvent> = (
  event: TEvent,
  context: HookContext
) => MaybePromise<void>;
export type StreamEventHooks<TKey extends HookEventKey = HookEventKey> = {
  readonly [TKey_ in TKey]?: StreamEventHook<HookEvent<TKey_>>;
};

export interface HookDefinition<TKey extends HookEventKey = HookEventKey> {
  readonly events?: StreamEventHooks<TKey>;
}

type DefinedHookEventKeys<TDefinition extends HookDefinition> = Extract<
  keyof NonNullable<TDefinition["events"]>,
  HookEventKey
>;

export function defineHook<const TDefinition extends HookDefinition>(
  definition: ExactDefinition<TDefinition, HookDefinition>
): HookDefinition<DefinedHookEventKeys<TDefinition>> {
  return definition;
}
