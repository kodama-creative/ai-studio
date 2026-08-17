import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export const SHELL_SERVICE = Symbol("ShellService");

export interface ShellRequests {
  openLink(url: string): Promise<void>;
  openDocument(path?: string): Promise<void>;
  reportBugs(): Promise<void>;
}

export type ShellRpc = RequestRpcShape<ShellRequests>;

export const SHELL_RPC = defineRpcNamespace<ShellRpc>("shell", {
  requests: { openLink: true, openDocument: true, reportBugs: true },
  streams: {},
  events: {},
});
