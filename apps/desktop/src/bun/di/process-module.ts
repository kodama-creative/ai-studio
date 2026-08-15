import { ContainerModule, type ServiceIdentifier } from "inversify";

import {
  PROCESS_TOKENS,
  type DesktopToken,
} from "./tokens";

type TokenValue<T> = T extends DesktopToken<infer TValue> ? TValue : never;
type ProcessServices = {
  readonly [TKey in Exclude<
    keyof typeof PROCESS_TOKENS,
    "playgroundApplication"
  >]: TokenValue<(typeof PROCESS_TOKENS)[TKey]>;
};

/** Bind already-constructed process singletons at the process composition seam. */
export function processServicesModule(
  services: ProcessServices
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    for (const key of Object.keys(services) as (keyof ProcessServices)[]) {
      const token = PROCESS_TOKENS[key];
      bind(token as ServiceIdentifier<unknown>).toConstantValue(services[key]);
    }
  });
}
