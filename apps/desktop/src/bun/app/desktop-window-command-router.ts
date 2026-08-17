import type { BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";

export const DESKTOP_WINDOW_COMMAND_ROUTER = Symbol(
  "DesktopWindowCommandRouter"
);

/** Routes a native menu intent to the renderer owned by one native window. */
export interface DesktopWindowCommandRouter {
  executeCommand(command: Command, window: BrowserWindow): void;
}
