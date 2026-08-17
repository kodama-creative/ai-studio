import type { BrowserWindow } from "electrobun/bun";

import type { DesktopWindowContext } from "../../shared/agent-project";
import type { NativeWindowStateBinding } from "../native/native-window-module";
import type { MainWindowRPC } from "../rpc";

export const NATIVE_WINDOW_FACTORY = Symbol("NativeWindowFactory");

/** Platform seam creating a native window around an already-live RPC bridge. */
export interface NativeWindowFactory {
  create(
    context: DesktopWindowContext,
    rpc: MainWindowRPC,
    attach: (window: BrowserWindow, state: NativeWindowStateBinding) => void
  ): Promise<BrowserWindow>;
}
