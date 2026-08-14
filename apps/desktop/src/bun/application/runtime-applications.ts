import type {
  AgentEvent,
  AgentStreamRequest,
  ModelConfig,
  ProviderConnectionRef,
} from "@llm-space/core";
import type {
  RuntimeClient,
  RuntimeId,
  RuntimeRouter,
} from "@llm-space/runtime/runtime";

import type { Analytics } from "../analytics";

/** Application interfaces are independent of the renderer RPC contracts. */
export interface RuntimesApplication {
  list(): Promise<ReturnType<RuntimeRouter["list"]>>;
  getDefault(): Promise<RuntimeId>;
  setDefault(runtimeId: RuntimeId): Promise<void>;
}

export interface ModelsApplication {
  list(id?: RuntimeId): ReturnType<RuntimeClient["availableModels"]>;
  listBuiltin(id?: RuntimeId): ReturnType<RuntimeClient["builtinProviders"]>;
  removeProvider(id: RuntimeId | undefined, providerId: string): ReturnType<RuntimeClient["removeProvider"]>;
  addProvider(id: RuntimeId | undefined, providerId: string): ReturnType<RuntimeClient["addProvider"]>;
  addCustomProvider(id: RuntimeId | undefined, input: Parameters<RuntimeClient["addCustomProvider"]>[0]): ReturnType<RuntimeClient["addCustomProvider"]>;
  addProfile(id: RuntimeId | undefined, providerId: string): ReturnType<RuntimeClient["addProviderProfile"]>;
  updateProfile(id: RuntimeId | undefined, input: Parameters<RuntimeClient["updateProviderProfile"]>[0]): ReturnType<RuntimeClient["updateProviderProfile"]>;
  removeProfile(id: RuntimeId | undefined, providerId: string, profileId: string): ReturnType<RuntimeClient["removeProviderProfile"]>;
  updateProvider(id: RuntimeId | undefined, input: Parameters<RuntimeClient["updateProvider"]>[0]): ReturnType<RuntimeClient["updateProvider"]>;
  setEnabled(id: RuntimeId | undefined, providerId: string, modelId: string, enabled: boolean): ReturnType<RuntimeClient["setModelEnabled"]>;
  setAllEnabled(id: RuntimeId | undefined, providerId: string, enabled: boolean): ReturnType<RuntimeClient["setAllModelsEnabled"]>;
  getDefault(id?: RuntimeId): ReturnType<RuntimeClient["getDefaultModel"]>;
  setDefault(id: RuntimeId | undefined, model: ModelConfig | null): ReturnType<RuntimeClient["setDefaultModel"]>;
  testConnection(id: RuntimeId | undefined, input: Parameters<RuntimeClient["testModelConnection"]>[0]): ReturnType<RuntimeClient["testModelConnection"]>;
  removeCustom(id: RuntimeId | undefined, providerId: string, modelId: string): ReturnType<RuntimeClient["removeCustomModel"]>;
  upsertCustom(id: RuntimeId | undefined, providerId: string, model: Parameters<RuntimeClient["upsertCustomModel"]>[0]["model"], originalId?: string): ReturnType<RuntimeClient["upsertCustomModel"]>;
  resolveGeneratorEnv(id: RuntimeId | undefined, input: Parameters<RuntimeClient["resolveGeneratorEnv"]>[0]): ReturnType<RuntimeClient["resolveGeneratorEnv"]>;
}

export interface WorkspaceApplication {
  list(id: RuntimeId | undefined, path: string): ReturnType<RuntimeClient["fsLs"]>;
  createDirectory(id: RuntimeId | undefined, path: string): ReturnType<RuntimeClient["fsMkdir"]>;
  copy(id: RuntimeId | undefined, source: string, destination: string): ReturnType<RuntimeClient["fsCp"]>;
  move(id: RuntimeId | undefined, source: string, destination: string): ReturnType<RuntimeClient["fsMv"]>;
  remove(id: RuntimeId | undefined, path: string): ReturnType<RuntimeClient["fsRm"]>;
  readThread(id: RuntimeId | undefined, path: string): ReturnType<RuntimeClient["fsRead"]>;
  writeThread(id: RuntimeId | undefined, path: string, thread: Parameters<RuntimeClient["fsWrite"]>[1]): ReturnType<RuntimeClient["fsWrite"]>;
  resolvePath(id: RuntimeId | undefined, path: string): ReturnType<RuntimeClient["fsRealpath"]>;
}

export interface PromptFilesApplication {
  readText(id: RuntimeId, path: string): ReturnType<RuntimeClient["readTextFile"]>;
  exists(id: RuntimeId, path: string): ReturnType<RuntimeClient["textFileExists"]>;
}

export interface McpApplication {
  listServers(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["mcpListServers"]>>>;
  addServer(id: RuntimeId | undefined, server: Parameters<RuntimeClient["mcpAddServer"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["mcpAddServer"]>>>;
  updateServer(id: RuntimeId | undefined, serverId: string, server: Parameters<RuntimeClient["mcpUpdateServer"]>[1]): Promise<Awaited<ReturnType<RuntimeClient["mcpUpdateServer"]>>>;
  removeServer(id: RuntimeId | undefined, serverId: string): Promise<Awaited<ReturnType<RuntimeClient["mcpRemoveServer"]>>>;
  disconnectServer(id: RuntimeId | undefined, serverId: string): Promise<Awaited<ReturnType<RuntimeClient["mcpDisconnectServer"]>>>;
  cancelTest(id: RuntimeId | undefined, serverId: string): Promise<Awaited<ReturnType<RuntimeClient["mcpCancelTest"]>>>;
  listTools(id: RuntimeId | undefined, serverId: string): Promise<Awaited<ReturnType<RuntimeClient["mcpListTools"]>>>;
  callTool(id: RuntimeId | undefined, input: Parameters<RuntimeClient["mcpCallTool"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["mcpCallTool"]>>>;
}

export interface BuiltinToolsApplication {
  list(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["builtInListTools"]>>>;
  call(id: RuntimeId | undefined, input: Parameters<RuntimeClient["builtInCallTool"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["builtInCallTool"]>>>;
}

export interface SearchApplication {
  get(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["getSearchSettings"]>>>;
  set(id: RuntimeId | undefined, settings: Parameters<RuntimeClient["setSearchSettings"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["setSearchSettings"]>>>;
}

export interface NetworkApplication {
  get(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["getNetworkSettings"]>>>;
  set(id: RuntimeId | undefined, settings: Parameters<RuntimeClient["setNetworkSettings"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["setNetworkSettings"]>>>;
  detectSystemProxy(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["detectSystemProxy"]>>>;
}

export interface SkillsApplication {
  getSettings(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["skillsGetSettings"]>>>;
  addPath(id: RuntimeId | undefined, path: string): Promise<Awaited<ReturnType<RuntimeClient["skillsAddPath"]>>>;
  removePath(id: RuntimeId | undefined, path: string): Promise<Awaited<ReturnType<RuntimeClient["skillsRemovePath"]>>>;
  setHidden(id: RuntimeId | undefined, input: Parameters<RuntimeClient["skillsSetSkillHidden"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["skillsSetSkillHidden"]>>>;
  setPluginHidden(id: RuntimeId | undefined, input: Parameters<RuntimeClient["skillsSetPluginSkillHidden"]>[0]): Promise<Awaited<ReturnType<RuntimeClient["skillsSetPluginSkillHidden"]>>>;
  setAllPluginHidden(id: RuntimeId | undefined, pluginId: string, hidden: boolean): Promise<Awaited<ReturnType<RuntimeClient["skillsSetAllPluginSkillsHidden"]>>>;
  setAllHidden(id: RuntimeId | undefined, path: string, hidden: boolean): Promise<Awaited<ReturnType<RuntimeClient["skillsSetAllSkillsHidden"]>>>;
  listAvailable(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["skillsListAvailable"]>>>;
  listPlugin(id?: RuntimeId): Promise<Awaited<ReturnType<RuntimeClient["skillsListPluginSkills"]>>>;
  list(id: RuntimeId | undefined, path: string): Promise<Awaited<ReturnType<RuntimeClient["skillsListSkills"]>>>;
  read(id: RuntimeId | undefined, path: string): Promise<Awaited<ReturnType<RuntimeClient["skillsReadSkill"]>>>;
}

export interface AgentExecutionApplication {
  stream(runtimeId: RuntimeId | undefined, request: AgentStreamRequest, options?: { connection?: ProviderConnectionRef; signal?: AbortSignal }): AsyncIterable<AgentEvent>;
}

/** Runtime selection is an application concern shared by capability modules. */
abstract class RuntimeApplication {
  constructor(protected readonly _router: RuntimeRouter) {}
  protected _runtime(
    runtimeId: RuntimeId | undefined,
    capability: Parameters<RuntimeRouter["require"]>[1]
  ): RuntimeClient {
    return this._router.require(runtimeId, capability);
  }
}

export class RuntimesApplicationImpl implements RuntimesApplication {
  constructor(private readonly _router: RuntimeRouter) {}
  list() {
    return Promise.resolve(this._router.list());
  }
  getDefault() {
    return Promise.resolve(this._router.getDefaultRuntimeId());
  }
  setDefault(runtimeId: RuntimeId) {
    this._router.setDefaultRuntime(runtimeId);
    return Promise.resolve();
  }
}

export class ModelsApplicationImpl
  extends RuntimeApplication
  implements ModelsApplication
{
  constructor(
    router: RuntimeRouter,
    private readonly _analytics: Analytics
  ) {
    super(router);
  }
  list(id?: RuntimeId) {
    return this._runtime(id, "models").availableModels();
  }
  listBuiltin(id?: RuntimeId) {
    return this._runtime(id, "models").builtinProviders();
  }
  removeProvider(id: RuntimeId | undefined, providerId: string) {
    return this._runtime(id, "models").removeProvider(providerId);
  }
  async addProvider(id: RuntimeId | undefined, providerId: string) {
    const groups = await this._runtime(id, "models").addProvider(providerId);
    this._analytics.capture("provider_added", { providerId, kind: "builtin" });
    return groups;
  }
  async addCustomProvider(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["addCustomProvider"]>[0]
  ) {
    const groups = await this._runtime(id, "models").addCustomProvider(input);
    // Provider identity is useful for product metrics; names and URLs are never captured.
    this._analytics.capture("provider_added", {
      providerId: input.id,
      kind: "custom",
    });
    return groups;
  }
  addProfile(id: RuntimeId | undefined, providerId: string) {
    return this._runtime(id, "models").addProviderProfile(providerId);
  }
  updateProfile(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["updateProviderProfile"]>[0]
  ) {
    return this._runtime(id, "models").updateProviderProfile(input);
  }
  removeProfile(
    id: RuntimeId | undefined,
    providerId: string,
    profileId: string
  ) {
    return this._runtime(id, "models").removeProviderProfile({
      providerId,
      profileId,
    });
  }
  updateProvider(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["updateProvider"]>[0]
  ) {
    return this._runtime(id, "models").updateProvider(input);
  }
  setEnabled(
    id: RuntimeId | undefined,
    providerId: string,
    modelId: string,
    enabled: boolean
  ) {
    return this._runtime(id, "models").setModelEnabled({
      providerId,
      modelId,
      enabled,
    });
  }
  setAllEnabled(
    id: RuntimeId | undefined,
    providerId: string,
    enabled: boolean
  ) {
    return this._runtime(id, "models").setAllModelsEnabled({
      providerId,
      enabled,
    });
  }
  getDefault(id?: RuntimeId) {
    return this._runtime(id, "models").getDefaultModel();
  }
  setDefault(
    id: RuntimeId | undefined,
    model: ModelConfig | null
  ) {
    return this._runtime(id, "models").setDefaultModel(model);
  }
  testConnection(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["testModelConnection"]>[0]
  ) {
    return this._runtime(id, "models").testModelConnection(input);
  }
  removeCustom(id: RuntimeId | undefined, providerId: string, modelId: string) {
    return this._runtime(id, "models").removeCustomModel({
      providerId,
      modelId,
    });
  }
  upsertCustom(
    id: RuntimeId | undefined,
    providerId: string,
    model: Parameters<RuntimeClient["upsertCustomModel"]>[0]["model"],
    originalId?: string
  ) {
    return this._runtime(id, "models").upsertCustomModel({
      providerId,
      model,
      originalId,
    });
  }
  resolveGeneratorEnv(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["resolveGeneratorEnv"]>[0]
  ) {
    return this._runtime(id, "models").resolveGeneratorEnv(input);
  }
}

export class WorkspaceApplicationImpl
  extends RuntimeApplication
  implements WorkspaceApplication
{
  list(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "filesystem").fsLs(path);
  }
  createDirectory(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "filesystem").fsMkdir(path);
  }
  copy(id: RuntimeId | undefined, source: string, destination: string) {
    return this._runtime(id, "filesystem").fsCp(source, destination);
  }
  move(id: RuntimeId | undefined, source: string, destination: string) {
    return this._runtime(id, "filesystem").fsMv(source, destination);
  }
  remove(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "filesystem").fsRm(path);
  }
  readThread(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "filesystem").fsRead(path);
  }
  writeThread(
    id: RuntimeId | undefined,
    path: string,
    thread: Parameters<RuntimeClient["fsWrite"]>[1]
  ) {
    return this._runtime(id, "filesystem").fsWrite(path, thread);
  }
  resolvePath(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "filesystem").fsRealpath(path);
  }
}

export class PromptFilesApplicationImpl
  extends RuntimeApplication
  implements PromptFilesApplication
{
  readText(id: RuntimeId, path: string) {
    return this._runtime(id, "filesystem").readTextFile(path);
  }
  exists(id: RuntimeId, path: string) {
    return this._runtime(id, "filesystem").textFileExists(path);
  }
}

export class McpApplicationImpl
  extends RuntimeApplication
  implements McpApplication
{
  async listServers(id?: RuntimeId) {
    return this._runtime(id, "mcp").mcpListServers();
  }
  async addServer(
    id: RuntimeId | undefined,
    server: Parameters<RuntimeClient["mcpAddServer"]>[0]
  ) {
    return this._runtime(id, "mcp").mcpAddServer(server);
  }
  updateServer(
    id: RuntimeId | undefined,
    serverId: string,
    server: Parameters<RuntimeClient["mcpUpdateServer"]>[1]
  ) {
    return this._runtime(id, "mcp").mcpUpdateServer(serverId, server);
  }
  removeServer(id: RuntimeId | undefined, serverId: string) {
    return this._runtime(id, "mcp").mcpRemoveServer(serverId);
  }
  disconnectServer(id: RuntimeId | undefined, serverId: string) {
    return this._runtime(id, "mcp").mcpDisconnectServer(serverId);
  }
  cancelTest(id: RuntimeId | undefined, serverId: string) {
    return this._runtime(id, "mcp").mcpCancelTest(serverId);
  }
  listTools(id: RuntimeId | undefined, serverId: string) {
    return this._runtime(id, "mcp").mcpListTools(serverId);
  }
  callTool(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["mcpCallTool"]>[0]
  ) {
    return this._runtime(id, "mcp").mcpCallTool(input);
  }
}

export class BuiltinToolsApplicationImpl
  extends RuntimeApplication
  implements BuiltinToolsApplication
{
  async list(id?: RuntimeId) {
    return this._runtime(id, "builtinTools").builtInListTools();
  }
  call(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["builtInCallTool"]>[0]
  ) {
    return this._runtime(id, "builtinTools").builtInCallTool(input);
  }
}

export class SearchApplicationImpl
  extends RuntimeApplication
  implements SearchApplication
{
  async get(id?: RuntimeId) {
    return this._runtime(id, "search").getSearchSettings();
  }
  async set(
    id: RuntimeId | undefined,
    settings: Parameters<RuntimeClient["setSearchSettings"]>[0]
  ) {
    return this._runtime(id, "search").setSearchSettings(settings);
  }
}
export class NetworkApplicationImpl
  extends RuntimeApplication
  implements NetworkApplication
{
  async get(id?: RuntimeId) {
    return this._runtime(id, "network").getNetworkSettings();
  }
  async set(
    id: RuntimeId | undefined,
    settings: Parameters<RuntimeClient["setNetworkSettings"]>[0]
  ) {
    return this._runtime(id, "network").setNetworkSettings(settings);
  }
  async detectSystemProxy(id?: RuntimeId) {
    return this._runtime(id, "network").detectSystemProxy();
  }
}

export class SkillsApplicationImpl
  extends RuntimeApplication
  implements SkillsApplication
{
  async getSettings(id?: RuntimeId) {
    return this._runtime(id, "skills").skillsGetSettings();
  }
  async addPath(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "skills").skillsAddPath(path);
  }
  async removePath(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "skills").skillsRemovePath(path);
  }
  async setHidden(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["skillsSetSkillHidden"]>[0]
  ) {
    return this._runtime(id, "skills").skillsSetSkillHidden(input);
  }
  async setPluginHidden(
    id: RuntimeId | undefined,
    input: Parameters<RuntimeClient["skillsSetPluginSkillHidden"]>[0]
  ) {
    return this._runtime(id, "skills").skillsSetPluginSkillHidden(input);
  }
  async setAllPluginHidden(
    id: RuntimeId | undefined,
    pluginId: string,
    hidden: boolean
  ) {
    return this._runtime(id, "skills").skillsSetAllPluginSkillsHidden({
      pluginId,
      hidden,
    });
  }
  async setAllHidden(id: RuntimeId | undefined, path: string, hidden: boolean) {
    return this._runtime(id, "skills").skillsSetAllSkillsHidden({
      path,
      hidden,
    });
  }
  async listAvailable(id?: RuntimeId) {
    return this._runtime(id, "skills").skillsListAvailable();
  }
  async listPlugin(id?: RuntimeId) {
    return this._runtime(id, "skills").skillsListPluginSkills();
  }
  async list(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "skills").skillsListSkills(path);
  }
  async read(id: RuntimeId | undefined, path: string) {
    return this._runtime(id, "skills").skillsReadSkill(path);
  }
}

export class AgentExecutionApplicationImpl
  extends RuntimeApplication
  implements AgentExecutionApplication
{
  async *stream(
    runtimeId: RuntimeId | undefined,
    request: AgentStreamRequest,
    options: { connection?: ProviderConnectionRef; signal?: AbortSignal } = {}
  ): AsyncIterable<AgentEvent> {
    const runtime = this._runtime(runtimeId, "streamThread");
    const streamId = crypto.randomUUID();
    const signal = options.signal;
    if (signal?.aborted) throw _abortError();
    let queue: AgentEvent[] = [];
    let queueHead = 0;
    let wake: (() => void) | undefined;
    let done = false;
    let aborted = false;
    let failure: Error | undefined;
    const finish = () => {
      done = true;
      wake?.();
      wake = undefined;
    };
    const onAbort = () => {
      aborted = true;
      runtime.abortStream({ runtimeId, streamId });
      finish();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    void runtime
      .streamThread(
        { runtimeId, streamId, request, connection: options.connection },
        (message) => {
          if (message.type === "event") queue.push(message.event);
          else if (message.type === "error")
            failure = new Error(message.message);
          if (message.type !== "event") done = true;
          wake?.();
          wake = undefined;
        }
      )
      .catch((error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        finish();
      });
    try {
      while (!done || queueHead < queue.length) {
        const event = queue[queueHead];
        if (event) {
          queueHead += 1;
          yield event;
          // Avoid O(n²) Array.shift() while bounding retained burst entries.
          if (queueHead >= 1024 && queueHead * 2 >= queue.length) {
            queue = queue.slice(queueHead);
            queueHead = 0;
          }
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (aborted) throw _abortError();
      if (failure) throw failure;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (!done) runtime.abortStream({ runtimeId, streamId });
    }
  }
}

function _abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
