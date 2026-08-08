import type { UserContent } from "ai";

import type { RouteDefinition } from "./routes";

declare const CHANNEL_METADATA_TYPE: unique symbol;

export interface FetchFileResult {
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
  readonly filename?: string;
}

export type FetchFileFunction = (
  url: string
) => Promise<Uint8Array | FetchFileResult | null>;

export interface ReceiveInput<TReceiveTarget = Record<string, unknown>> {
  readonly message: string | UserContent;
  readonly target: Readonly<TReceiveTarget>;
  readonly auth: Readonly<Record<string, unknown>> | null;
}

export interface ChannelContinuationOps {
  readonly continuation?: {
    readonly token: string;
    rekey(token: string): void;
  };
}

export type ChannelContext<TContext> = TContext & ChannelContinuationOps;
export type ChannelEvents<TContext = void> = Readonly<
  Record<
    string,
    (
      event: unknown,
      channel: ChannelContext<TContext>,
      context: unknown
    ) => void | Promise<void>
  >
>;

export interface ChannelDefinition<
  TState = undefined,
  TContext = void,
  TReceiveTarget = Record<string, unknown>,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly state?: TState;
  readonly cors?: boolean | Readonly<Record<string, unknown>>;
  context?(state: NonNullable<TState>, session: unknown): TContext;
  readonly routes: readonly RouteDefinition<TState>[];
  receive?(
    input: ReceiveInput<TReceiveTarget>,
    context: { readonly state: NonNullable<TState> }
  ): Promise<unknown>;
  readonly events?: Partial<ChannelEvents<TContext>>;
  readonly fetchFile?: FetchFileFunction;
  readonly metadata?: (state: NonNullable<TState>) => TMetadata;
  readonly kindHint?: string;
}

export interface Channel<
  TState = undefined,
  TReceiveTarget = Record<string, unknown>,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly [CHANNEL_METADATA_TYPE]?: TMetadata;
  readonly routes: readonly RouteDefinition<TState>[];
  readonly cors?: boolean | Readonly<Record<string, unknown>>;
  readonly receive?: ChannelDefinition<
    TState,
    void,
    TReceiveTarget,
    TMetadata
  >["receive"];
}

export type ChannelFrom<T> =
  T extends Channel<infer TState, infer TTarget, infer TMetadata>
    ? Channel<TState, TTarget, TMetadata>
    : never;
export type InferChannelMetadata<T> =
  T extends Channel<unknown, unknown, infer TMetadata>
    ? TMetadata
    : Record<string, unknown>;

export function defineChannel<
  TState = undefined,
  TContext = void,
  TReceiveTarget = Record<string, unknown>,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
>(
  definition: ChannelDefinition<TState, TContext, TReceiveTarget, TMetadata>
): Channel<TState, TReceiveTarget, TMetadata> {
  return definition;
}

export interface InstrumentationChannel {
  readonly kind?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function isChannel<TChannel extends Channel>(
  channel: InstrumentationChannel,
  target: TChannel
): channel is InstrumentationChannel & {
  readonly metadata: InferChannelMetadata<TChannel>;
} {
  return channel.kind === (target as { kind?: string }).kind;
}
