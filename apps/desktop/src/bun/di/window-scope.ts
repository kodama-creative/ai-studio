import type { BrowserWindow } from "electrobun/bun";

import type { DesktopWindowScope } from "./process-container";
import { WINDOW_TOKENS } from "./tokens";

/** Connect one fully-bound window scope to Electrobun's native close lifecycle. */
export function attachWindowScope(scope: DesktopWindowScope): BrowserWindow {
  const window = scope.get<BrowserWindow>(WINDOW_TOKENS.browserWindow);
  let nativeClosed = false;
  scope.onDispose(() => {
    if (!nativeClosed) window.close();
  });
  window.on("close", () => {
    nativeClosed = true;
    void scope.dispose().catch((error) => {
      console.error(`Failed to dispose window scope "${scope.id}":`, error);
    });
  });
  return window;
}
