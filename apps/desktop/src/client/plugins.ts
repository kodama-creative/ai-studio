import type {
  JsonObject,
  JsonValue,
  BuiltinToolCallResponse,
  PluginCommandExecutionResult,
  PluginCommandView,
  PluginView,
  PluginTool,
  Thread,
  ThreadLocator,
  ThreadStorageView,
} from "@llm-space/core";

import { createRpcClientProxy } from "@/shared/namespaced-rpc";
import {
  PLUGIN_COMMANDS_RPC,
  PLUGINS_RPC,
  PLUGIN_TOOLS_RPC,
  THREAD_STORAGES_RPC,
} from "@/shared/plugin-rpc";
import type { RuntimeId } from "@/shared/runtime";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const transport = createElectrobunRpcClientTransport();
export const pluginsClient = createRpcClientProxy(PLUGINS_RPC, transport);
export const pluginCommandsClient = createRpcClientProxy(
  PLUGIN_COMMANDS_RPC,
  transport
);
export const pluginToolsClient = createRpcClientProxy(
  PLUGIN_TOOLS_RPC,
  transport
);
export const threadStoragesClient = createRpcClientProxy(
  THREAD_STORAGES_RPC,
  transport
);

/** Subscribe to any installed Plugin or contribution change. */
export function subscribePluginsChanged(listener: () => void): () => void {
  const subscription = pluginsClient.on("changed", listener);
  return () => subscription.dispose();
}

/** The mounted pane snapshot captured when a Plugin Command starts. */
export interface PluginActiveTab {
  tabId: string;
  paneId: string;
  path: string;
  filename: string;
  runtimeId: RuntimeId;
  thread: Thread;
}

export const listPlugins = (): Promise<PluginView[]> => pluginsClient.list();

export const refreshPlugins = (): Promise<PluginView[]> =>
  pluginsClient.refresh();

export const reloadPlugin = (pluginId: string): Promise<PluginView[]> =>
  pluginsClient.reload(pluginId);

export const setPluginEnabled = (
  pluginId: string,
  enabled: boolean
): Promise<PluginView[]> => pluginsClient.setEnabled(pluginId, enabled);

export const setPluginSettings = (
  pluginId: string,
  settings: JsonObject
): Promise<PluginView[]> => pluginsClient.setSettings(pluginId, settings);

export const listPluginCommands = (): Promise<PluginCommandView[]> =>
  pluginCommandsClient.list();

export const executePluginCommand = (
  executionId: string,
  commandId: string,
  activeTab: Pick<PluginActiveTab, "filename" | "thread"> | null,
  args: string[]
): Promise<PluginCommandExecutionResult> =>
  pluginCommandsClient.execute({
    executionId,
    commandId,
    activeTab,
    arguments: args,
  });

export const listPluginTools = (): Promise<PluginTool[]> =>
  pluginToolsClient.list();

export const executePluginTool = (
  tool: PluginTool,
  thread: Thread,
  variables: Record<string, JsonValue>,
  args: Record<string, unknown>
): Promise<BuiltinToolCallResponse> =>
  pluginToolsClient.execute(tool, thread, variables, args);

export const listThreadStorages = (): Promise<ThreadStorageView[]> =>
  threadStoragesClient.list();

export const resolveLatestThreadStorage = (
  storageId: string,
  resourceId: string
): Promise<ThreadLocator> =>
  threadStoragesClient.resolveLatest(storageId, resourceId);

export const readThreadStorage = (
  storageId: string,
  locator: ThreadLocator
): Promise<Thread> => threadStoragesClient.read(storageId, locator);

export const writeThreadStorage = (
  storageId: string,
  thread: Thread,
  resourceId?: string
): Promise<ThreadLocator> =>
  threadStoragesClient.write(storageId, thread, resourceId);
