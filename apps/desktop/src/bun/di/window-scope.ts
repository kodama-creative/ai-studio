import type { BrowserWindow } from "electrobun/bun";

import type { MainWindowRPC } from "../rpc";

import type { DesktopWindowScope } from "./process-container";
import { WINDOW_TOKENS } from "./tokens";

/** Connect one fully-bound window scope to Electrobun's native close lifecycle. */
export function attachWindowScope(
  scope: DesktopWindowScope,
  windowRpcs: Map<number, MainWindowRPC>
): BrowserWindow {
  const window = scope.get<BrowserWindow>(WINDOW_TOKENS.browserWindow);
  const rpc = scope.get<MainWindowRPC>(WINDOW_TOKENS.rpc);
  let nativeClosed = false;
  scope.onDispose(() => {
    windowRpcs.delete(window.id);
    if (!nativeClosed) window.close();
  });
  windowRpcs.set(window.id, rpc);
  window.on("close", () => {
    nativeClosed = true;
    void scope.dispose().catch((error) => {
      console.error(`Failed to dispose window scope "${scope.id}":`, error);
    });
  });
  return window;
}
