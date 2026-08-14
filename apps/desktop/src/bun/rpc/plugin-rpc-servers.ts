import type { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PLUGIN_COMMANDS_RPC,
  PLUGINS_RPC,
  PLUGIN_TOOLS_RPC,
	THREAD_STORAGES_RPC,
	type PluginCommandsRpc,
	type PluginsRpc,
	type PluginToolsRpc,
	type ThreadStoragesRpc,
} from "../../shared/plugin-rpc";
import type {
	PluginCommandsApplicationEvents,
	PluginCommandsApplicationApi,
	PluginsApplicationEvents,
	PluginsApplicationApi,
	PluginToolsApplicationApi,
	ThreadStoragesApplicationApi,
} from "../application/plugin-applications";

export class PluginsRpcServer implements RpcServer<PluginsRpc> {
  readonly namespace = PLUGINS_RPC;
  readonly streams = {};
	readonly eventSource;
	constructor(
		readonly requests: PluginsApplicationApi,
		events: EventHub<PluginsApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
export class PluginCommandsRpcServer implements RpcServer<PluginCommandsRpc> {
  readonly namespace = PLUGIN_COMMANDS_RPC;
  readonly streams = {};
	readonly eventSource;
	constructor(
		readonly requests: PluginCommandsApplicationApi,
		events: EventHub<PluginCommandsApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
export class PluginToolsRpcServer implements RpcServer<PluginToolsRpc> {
	readonly namespace = PLUGIN_TOOLS_RPC;
	readonly streams = {};
	constructor(readonly requests: PluginToolsApplicationApi) {}
}
export class ThreadStoragesRpcServer implements RpcServer<ThreadStoragesRpc> {
	readonly namespace = THREAD_STORAGES_RPC;
	readonly streams = {};
	constructor(readonly requests: ThreadStoragesApplicationApi) {}
}
