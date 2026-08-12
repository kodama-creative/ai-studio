import type { Studio } from "@llm-space/studio/server";
import type { BrowserWindow } from "electrobun/bun";
import { ContainerModule, type ServiceIdentifier } from "inversify";

import type { AgentProjectView } from "../../shared/agent-project";
import type { MainWindowRPCController } from "../rpc";

import {
  PROCESS_TOKENS,
  PROJECT_WINDOW_TOKENS,
  type DesktopToken,
  WINDOW_TOKENS,
} from "./tokens";

type TokenValue<T> = T extends DesktopToken<infer TValue> ? TValue : never;
type ProcessServices = {
  readonly [TKey in keyof typeof PROCESS_TOKENS]: TokenValue<
    (typeof PROCESS_TOKENS)[TKey]
  >;
};

/** Bind already-constructed process singletons without decorators. */
export function processModule(services: ProcessServices): ContainerModule {
  return new ContainerModule(({ bind }) => {
    for (const key of Object.keys(services) as (keyof ProcessServices)[]) {
      const token = PROCESS_TOKENS[key];
      bind(token as ServiceIdentifier<unknown>).toConstantValue(services[key]);
    }
  });
}

/** Bind the native window and RPC resources common to every window kind. */
export function windowModule(input: {
  readonly window: BrowserWindow;
  readonly rpcController: MainWindowRPCController;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.browserWindow).toConstantValue(input.window);
    bind(WINDOW_TOKENS.rpc).toConstantValue(input.rpcController.rpc);
  });
}

/** Main currently adds no private service beyond the common window module. */
export function mainWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.context).toConstantValue({ kind: "playground" });
  });
}

/** Bind one Project Studio and its immutable renderer-facing identity. */
export function projectWindowModule(input: {
  readonly project: AgentProjectView;
  readonly studio: Studio;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.context).toConstantValue({
      kind: "agentProject",
      project: input.project,
    });
    bind(PROJECT_WINDOW_TOKENS.project).toConstantValue(input.project);
    bind(PROJECT_WINDOW_TOKENS.studio).toConstantValue(input.studio);
  });
}
