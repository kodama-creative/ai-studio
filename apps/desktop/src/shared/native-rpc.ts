import type { DesktopWindowContext } from "./agent-project";
import { defineRpcNamespace } from "./namespaced-rpc";

interface RpcShape<TRequests extends object> {
  readonly requests: TRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export interface WindowRequests {
  getContext(): Promise<DesktopWindowContext>;
  toggleMaximized(): Promise<{ maximized: boolean }>;
  getFullscreenState(): Promise<{ fullScreen: boolean }>;
}
export interface WindowEvents {
  fullScreenChanged: { fullScreen: boolean };
}
export interface WindowRpc {
  readonly requests: WindowRequests;
  readonly streams: Record<never, never>;
  readonly events: WindowEvents;
}
export const WINDOW_RPC = defineRpcNamespace<WindowRpc>("window", {
  requests: {
    getContext: true,
    toggleMaximized: true,
    getFullscreenState: true,
  },
  streams: {},
  events: { fullScreenChanged: true },
});

export interface NativeDialogsRequests {
  pickFile(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
}
export type NativeDialogsRpc = RpcShape<NativeDialogsRequests>;
export const NATIVE_DIALOGS_RPC = defineRpcNamespace<NativeDialogsRpc>(
  "nativeDialogs",
  {
    requests: { pickFile: true, pickDirectory: true },
    streams: {},
    events: {},
  }
);

export interface NativeFilesRequests {
  directoryExists(path: string): Promise<boolean>;
  reveal(pathOrLocator: string): Promise<void>;
}
export type NativeFilesRpc = RpcShape<NativeFilesRequests>;
export const NATIVE_FILES_RPC = defineRpcNamespace<NativeFilesRpc>(
  "nativeFiles",
  {
    requests: { directoryExists: true, reveal: true },
    streams: {},
    events: {},
  }
);

export interface AppDirectoriesRequests {
  ensure(relativePath: string): Promise<string>;
}
export type AppDirectoriesRpc = RpcShape<AppDirectoriesRequests>;
export const APP_DIRECTORIES_RPC = defineRpcNamespace<AppDirectoriesRpc>(
  "appDirectories",
  { requests: { ensure: true }, streams: {}, events: {} }
);
