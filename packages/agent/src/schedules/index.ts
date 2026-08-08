import type { ExactDefinition, MaybePromise } from "../shared/types";

export interface ScheduleHandlerArgs {
  readonly appAuth: Readonly<Record<string, unknown>>;
  readonly to: ScheduleToFn;
  readonly waitUntil: (task: Promise<unknown>) => void;
}

export type ScheduleRunHandler = (
  args: ScheduleHandlerArgs
) => MaybePromise<void>;
export type ScheduleToFn = (...args: readonly unknown[]) => {
  send(
    message: unknown,
    options?: Readonly<Record<string, unknown>>
  ): Promise<unknown>;
};
export interface TypedReceiveTarget<T = unknown> {
  readonly address: T;
}

interface ScheduleDefinitionBase {
  readonly cron: string;
}

export type ScheduleDefinition = ScheduleDefinitionBase &
  (
    | { readonly markdown: string; readonly run?: never }
    | { readonly markdown?: never; readonly run: ScheduleRunHandler }
  );

export function defineSchedule<const T extends ScheduleDefinition>(
  definition: ExactDefinition<T, ScheduleDefinition>
): T {
  return definition;
}
