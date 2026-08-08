import type { ExactDefinition, MaybePromise } from "../shared/types";

export interface InstrumentationSetupContext {
  readonly agentName: string;
}
export interface InstrumentationDefinition {
  readonly functionId?: string;
  readonly recordInputs?: boolean;
  readonly recordOutputs?: boolean;
  readonly traceChannelRequests?: boolean;
  readonly setup?: (context: InstrumentationSetupContext) => MaybePromise<void>;
  readonly events?: Readonly<Record<string, (...args: never[]) => unknown>>;
}

export function defineInstrumentation<
  const T extends InstrumentationDefinition,
>(definition: ExactDefinition<T, InstrumentationDefinition>): T {
  return definition;
}

export { isChannel } from "../channels";
export type { InstrumentationChannel } from "../channels";
