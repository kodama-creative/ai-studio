import type { BrowserWindow } from "electrobun/bun";
import { ContainerModule } from "inversify";

import type { MainWindowRPCController } from "../rpc";

import { WINDOW_TOKENS } from "./tokens";

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
