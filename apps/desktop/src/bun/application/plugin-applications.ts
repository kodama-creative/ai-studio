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
import type { PluginManager } from "@llm-space/runtime/plugins";

import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type { PluginCommandExecutionEvent } from "../../shared/plugin-command-execution";
import type { PluginCommandExecutionController } from "../plugins/plugin-command-execution-controller";

/** Application contract for installed Plugin lifecycle operations. */
export interface PluginsApplicationApi {
	list(): Promise<PluginView[]>;
	refresh(): Promise<PluginView[]>;
	reload(pluginId: string): Promise<PluginView[]>;
	setEnabled(pluginId: string, enabled: boolean): Promise<PluginView[]>;
	setSettings(pluginId: string, settings: JsonObject): Promise<PluginView[]>;
}

/** Application contract for discovering and executing Plugin Commands. */
export interface PluginCommandsApplicationApi {
	list(): Promise<PluginCommandView[]>;
	execute(input: {
		executionId: string;
		commandId: string;
		arguments: string[];
		activeTab: { filename: string; thread: Thread } | null;
	}): Promise<PluginCommandExecutionResult>;
}

/** Application contract for Plugin-contributed tools. */
export interface PluginToolsApplicationApi {
	list(): Promise<PluginTool[]>;
	execute(
		tool: PluginTool,
		thread: Thread,
		variables: Record<string, JsonValue>,
		args: Record<string, unknown>
	): Promise<BuiltinToolCallResponse>;
}

/** Application contract for Plugin-contributed Thread storage providers. */
export interface ThreadStoragesApplicationApi {
	list(): Promise<ThreadStorageView[]>;
	resolveLatest(storageId: string, resourceId: string): Promise<ThreadLocator>;
	read(storageId: string, locator: ThreadLocator): Promise<Thread>;
	write(
		storageId: string,
		thread: Thread,
		resourceId?: string
	): Promise<ThreadLocator>;
}

export interface PluginsApplicationEvents {
  changed: Record<string, never>;
}

export interface PluginCommandsApplicationEvents {
  executionChanged: PluginCommandExecutionEvent;
}

/** Owns installed Plugin management and its change notification. */
export class PluginsApplication implements PluginsApplicationApi, Disposable {
  readonly events = new EventHub<PluginsApplicationEvents>();
  constructor(private readonly _plugins: PluginManager) {}
  list() {
    return Promise.resolve(this._plugins.listPlugins());
  }
  refresh() {
    return this._plugins.refreshPlugins();
  }
  async reload(pluginId: string) {
    await this._plugins.reloadPlugin(pluginId);
    return this._plugins.listPlugins();
  }
  setEnabled(pluginId: string, enabled: boolean) {
    return this._plugins.setEnabled(pluginId, enabled);
  }
	setSettings(
		pluginId: string,
		settings: JsonObject
  ) {
    return this._plugins.setSettings(pluginId, settings);
  }
  /** Bridge manager-originated changes, including subprocess failures. */
  notifyChanged(): void {
    this.events.publish("changed", {});
  }
  /** Release process-local Plugin observers. */
  dispose(): void {
    this.events.dispose();
  }
}

/** Exposes Plugin Commands without leaking the PluginManager registry. */
export class PluginCommandsApplication
	implements PluginCommandsApplicationApi, Disposable
{
  readonly events = new EventHub<PluginCommandsApplicationEvents>();
  constructor(
    private readonly _plugins: PluginManager,
    private readonly _executions: PluginCommandExecutionController
  ) {}
  list() {
    return Promise.resolve(this._plugins.commands.list());
  }
	execute(input: {
		executionId: string;
		commandId: string;
		arguments: string[];
		activeTab: { filename: string; thread: Thread } | null;
	}) {
    return this._executions.execute({
      ...input,
      context: { activeTab: input.activeTab },
    });
  }

  /** Own the only business event channel for Plugin Command progress. */
  notifyExecutionChanged(event: PluginCommandExecutionEvent): void {
    this.events.publish("executionChanged", event);
  }

  /** Release renderer observers while the process tears down. */
  dispose(): void {
    this.events.dispose();
  }
}

/** Exposes Plugin Tools without leaking the PluginManager registry. */
export class PluginToolsApplication implements PluginToolsApplicationApi {
  constructor(private readonly _plugins: PluginManager) {}
  list() {
    return Promise.resolve(this._plugins.tools.list());
  }
  execute(
		tool: PluginTool,
		thread: Thread,
		variables: Record<string, JsonValue>,
		args: Record<string, unknown>
  ) {
    return this._plugins.tools.execute(tool, { thread, variables }, args);
  }
}

/** Exposes Thread Storage contributions without leaking their registry. */
export class ThreadStoragesApplication
	implements ThreadStoragesApplicationApi
{
  constructor(private readonly _plugins: PluginManager) {}
  list() {
    return Promise.resolve(this._plugins.threadStorages.list());
  }
  resolveLatest(storageId: string, resourceId: string) {
    return this._plugins.threadStorages.resolveLatest(storageId, resourceId);
  }
	read(storageId: string, locator: ThreadLocator) {
    return this._plugins.threadStorages.read(storageId, locator);
  }
  write(
    storageId: string,
		thread: Thread,
    resourceId?: string
  ) {
    return this._plugins.threadStorages.write(storageId, thread, resourceId);
  }
}
