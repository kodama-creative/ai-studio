import type {
  BuiltinToolCallResponse,
  JsonObject,
  JsonValue,
  PluginCommandExecutionResult,
  PluginCommandView,
  PluginTool,
  PluginView,
  Thread,
  ThreadLocator,
  ThreadStorageView,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { PluginCommandExecutionEvent } from "./plugin-command-execution";

export interface PluginsRequests {
  list(): Promise<PluginView[]>;
  refresh(): Promise<PluginView[]>;
  reload(pluginId: string): Promise<PluginView[]>;
  setEnabled(pluginId: string, enabled: boolean): Promise<PluginView[]>;
  setSettings(pluginId: string, settings: JsonObject): Promise<PluginView[]>;
}
export interface PluginsEvents {
  changed: Record<string, never>;
}
export interface PluginsRpc {
  readonly requests: PluginsRequests;
  readonly streams: Record<never, never>;
  readonly events: PluginsEvents;
}
export const PLUGINS_RPC = defineRpcNamespace<PluginsRpc>("plugins", {
  streams: [],
  events: ["changed"],
});

export interface PluginCommandsRequests {
  list(): Promise<PluginCommandView[]>;
  execute(input: {
    executionId: string;
    commandId: string;
    arguments: string[];
    activeTab: { filename: string; thread: Thread } | null;
  }): Promise<PluginCommandExecutionResult>;
}
export interface PluginCommandsEvents {
  executionChanged: PluginCommandExecutionEvent;
}
export interface PluginCommandsRpc {
  readonly requests: PluginCommandsRequests;
  readonly streams: Record<never, never>;
  readonly events: PluginCommandsEvents;
}
export const PLUGIN_COMMANDS_RPC = defineRpcNamespace<PluginCommandsRpc>(
  "pluginCommands",
  { streams: [], events: ["executionChanged"] }
);

export interface PluginToolsRequests {
  list(): Promise<PluginTool[]>;
  execute(
    tool: PluginTool,
    thread: Thread,
    variables: Record<string, JsonValue>,
    args: Record<string, unknown>
  ): Promise<BuiltinToolCallResponse>;
}
export interface PluginToolsRpc {
  readonly requests: PluginToolsRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}
export const PLUGIN_TOOLS_RPC = defineRpcNamespace<PluginToolsRpc>(
  "pluginTools",
  { streams: [], events: [] }
);

export interface ThreadStoragesRequests {
  list(): Promise<ThreadStorageView[]>;
  resolveLatest(storageId: string, resourceId: string): Promise<ThreadLocator>;
  read(storageId: string, locator: ThreadLocator): Promise<Thread>;
  write(
    storageId: string,
    thread: Thread,
    resourceId?: string
  ): Promise<ThreadLocator>;
}
export interface ThreadStoragesRpc {
  readonly requests: ThreadStoragesRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}
export const THREAD_STORAGES_RPC = defineRpcNamespace<ThreadStoragesRpc>(
  "threadStorages",
  { streams: [], events: [] }
);
