import type { DesktopProcessContainer } from "./process-container";
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

/** Bind and eagerly adopt already-constructed process constants. */
export function bindProcessServices(
  process: DesktopProcessContainer,
  services: ProcessServices
): void {
  for (const key of Object.keys(services) as (keyof ProcessServices)[]) {
    const token = PROCESS_TOKENS[key];
    process.bindConstant(token, services[key]);
  }
}
