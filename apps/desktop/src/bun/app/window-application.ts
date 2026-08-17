import type { BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import type { MainWindowRPC } from "../rpc";

/** Lifecycle and renderer-command surface shared by native window roots. */
export interface DesktopWindowApplication {
  readonly rpc: MainWindowRPC;
  start(): Promise<BrowserWindow>;
  stop(): Promise<void>;
  execute(command: Command): void;
}
