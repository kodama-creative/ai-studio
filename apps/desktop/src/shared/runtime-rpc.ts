import type {
  AgentEvent,
  AgentStreamRequest,
  ArkImageGenerationConfig,
  BuiltinTool,
  BuiltinToolCallResponse,
  CustomModel,
  FileNode,
  McpCallToolResponse,
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView,
  ModelConfig,
  ModelProviderGroup,
  NetworkSettings,
  ProviderConnectionRef,
  ProviderProfilePatch,
  SearchSettings,
  SkillContent,
  SkillInfo,
  SkillsSettings,
  SystemProxyDetection,
  Thread,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RuntimeId, RuntimeView } from "./runtime";

interface RpcShape<
  TRequests extends object,
  TStreams extends object = Record<never, never>,
> {
  readonly requests: TRequests;
  readonly streams: TStreams;
  readonly events: Record<never, never>;
}

export interface RuntimesRequests {
  list(): Promise<RuntimeView[]>;
  getDefault(): Promise<RuntimeId>;
  setDefault(runtimeId: RuntimeId): Promise<void>;
}
export type RuntimesRpc = RpcShape<RuntimesRequests>;
export const RUNTIMES_RPC = defineRpcNamespace<RuntimesRpc>("runtimes", {
  streams: [],
  events: [],
});

export interface ModelsRequests {
  list(runtimeId?: RuntimeId): Promise<ModelProviderGroup[]>;
  listBuiltin(runtimeId?: RuntimeId): Promise<ModelProviderGroup[]>;
  removeProvider(
    runtimeId: RuntimeId | undefined,
    providerId: string
  ): Promise<ModelProviderGroup[]>;
  addProvider(
    runtimeId: RuntimeId | undefined,
    providerId: string
  ): Promise<ModelProviderGroup[]>;
  addCustomProvider(
    runtimeId: RuntimeId | undefined,
    input: {
      id: string;
      name: string;
      baseUrl: string;
      api?: "anthropic-messages" | "openai-completions" | "openai-responses";
    }
  ): Promise<ModelProviderGroup[]>;
  addProfile(
    runtimeId: RuntimeId | undefined,
    providerId: string
  ): Promise<ModelProviderGroup[]>;
  updateProfile(
    runtimeId: RuntimeId | undefined,
    input: { providerId: string; profileId: string } & ProviderProfilePatch
  ): Promise<ModelProviderGroup[]>;
  removeProfile(
    runtimeId: RuntimeId | undefined,
    providerId: string,
    profileId: string
  ): Promise<ModelProviderGroup[]>;
  updateProvider(
    runtimeId: RuntimeId | undefined,
    input: {
      providerId: string;
      name?: string | null;
      api?:
        "anthropic-messages" | "openai-completions" | "openai-responses" | null;
      icon?: string | null;
      imageGeneration?: ArkImageGenerationConfig;
    }
  ): Promise<ModelProviderGroup[]>;
  setEnabled(
    runtimeId: RuntimeId | undefined,
    providerId: string,
    modelId: string,
    enabled: boolean
  ): Promise<ModelProviderGroup[]>;
  setAllEnabled(
    runtimeId: RuntimeId | undefined,
    providerId: string,
    enabled: boolean
  ): Promise<ModelProviderGroup[]>;
  getDefault(runtimeId?: RuntimeId): Promise<ModelConfig | null>;
  setDefault(
    runtimeId: RuntimeId | undefined,
    model: ModelConfig | null
  ): Promise<ModelConfig | null>;
  testConnection(
    runtimeId: RuntimeId | undefined,
    input: {
      providerId: string;
      profileId?: string;
      modelId: string;
      candidate?: CustomModel;
    }
  ): Promise<void>;
  removeCustom(
    runtimeId: RuntimeId | undefined,
    providerId: string,
    modelId: string
  ): Promise<ModelProviderGroup[]>;
  upsertCustom(
    runtimeId: RuntimeId | undefined,
    providerId: string,
    model: CustomModel,
    originalId?: string
  ): Promise<ModelProviderGroup[]>;
  resolveGeneratorEnv(
    runtimeId: RuntimeId | undefined,
    input: { providerId: string; profileId?: string; envNames: string[] }
  ): Promise<{ modelApiKey: string; envValues: Record<string, string> }>;
}
export type ModelsRpc = RpcShape<ModelsRequests>;
export const MODELS_RPC = defineRpcNamespace<ModelsRpc>("models", {
  streams: [],
  events: [],
});

export interface WorkspaceRequests {
  list(runtimeId: RuntimeId | undefined, path: string): Promise<FileNode[]>;
  createDirectory(
    runtimeId: RuntimeId | undefined,
    path: string
  ): Promise<void>;
  copy(
    runtimeId: RuntimeId | undefined,
    source: string,
    destination: string
  ): Promise<void>;
  move(
    runtimeId: RuntimeId | undefined,
    source: string,
    destination: string
  ): Promise<void>;
  remove(runtimeId: RuntimeId | undefined, path: string): Promise<void>;
  readThread(runtimeId: RuntimeId | undefined, path: string): Promise<Thread>;
  writeThread(
    runtimeId: RuntimeId | undefined,
    path: string,
    thread: Thread
  ): Promise<void>;
  resolvePath(runtimeId: RuntimeId | undefined, path: string): Promise<string>;
}
export type WorkspaceRpc = RpcShape<WorkspaceRequests>;
export const WORKSPACE_RPC = defineRpcNamespace<WorkspaceRpc>("workspace", {
  streams: [],
  events: [],
});

export interface PromptFilesRequests {
  readText(runtimeId: RuntimeId, path: string): Promise<string>;
  exists(runtimeId: RuntimeId, path: string): Promise<boolean>;
}
export type PromptFilesRpc = RpcShape<PromptFilesRequests>;
export const PROMPT_FILES_RPC = defineRpcNamespace<PromptFilesRpc>(
  "promptFiles",
  { streams: [], events: [] }
);

export interface McpRequests {
  listServers(runtimeId?: RuntimeId): Promise<McpServerView[]>;
  addServer(
    runtimeId: RuntimeId | undefined,
    server: McpServerDraft
  ): Promise<McpServerView[]>;
  updateServer(
    runtimeId: RuntimeId | undefined,
    serverId: string,
    server: McpServerDraft
  ): Promise<McpServerView[]>;
  removeServer(
    runtimeId: RuntimeId | undefined,
    serverId: string
  ): Promise<McpServerView[]>;
  disconnectServer(
    runtimeId: RuntimeId | undefined,
    serverId: string
  ): Promise<McpServerView[]>;
  cancelTest(
    runtimeId: RuntimeId | undefined,
    serverId: string
  ): Promise<McpServerView[]>;
  listTools(
    runtimeId: RuntimeId | undefined,
    serverId: string
  ): Promise<McpServerToolsResponse>;
  callTool(
    runtimeId: RuntimeId | undefined,
    input: {
      serverId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  ): Promise<McpCallToolResponse>;
}
export type McpRpc = RpcShape<McpRequests>;
export const MCP_RPC = defineRpcNamespace<McpRpc>("mcp", {
  streams: [],
  events: [],
});

export interface BuiltinToolsRequests {
  list(runtimeId?: RuntimeId): Promise<BuiltinTool[]>;
  call(
    runtimeId: RuntimeId | undefined,
    input: {
      name: string;
      arguments: Record<string, unknown>;
      config?: Record<string, unknown>;
      connection?: ProviderConnectionRef;
    }
  ): Promise<BuiltinToolCallResponse>;
}
export type BuiltinToolsRpc = RpcShape<BuiltinToolsRequests>;
export const BUILTIN_TOOLS_RPC = defineRpcNamespace<BuiltinToolsRpc>(
  "builtinTools",
  { streams: [], events: [] }
);

export interface SearchRequests {
  get(runtimeId?: RuntimeId): Promise<SearchSettings>;
  set(
    runtimeId: RuntimeId | undefined,
    settings: SearchSettings
  ): Promise<SearchSettings>;
}
export type SearchRpc = RpcShape<SearchRequests>;
export const SEARCH_RPC = defineRpcNamespace<SearchRpc>("search", {
  streams: [],
  events: [],
});

export interface NetworkRequests {
  get(runtimeId?: RuntimeId): Promise<NetworkSettings>;
  set(
    runtimeId: RuntimeId | undefined,
    settings: NetworkSettings
  ): Promise<NetworkSettings>;
  detectSystemProxy(runtimeId?: RuntimeId): Promise<SystemProxyDetection>;
}
export type NetworkRpc = RpcShape<NetworkRequests>;
export const NETWORK_RPC = defineRpcNamespace<NetworkRpc>("network", {
  streams: [],
  events: [],
});

export interface SkillsRequests {
  getSettings(runtimeId?: RuntimeId): Promise<SkillsSettings>;
  addPath(
    runtimeId: RuntimeId | undefined,
    path: string
  ): Promise<SkillsSettings>;
  removePath(
    runtimeId: RuntimeId | undefined,
    path: string
  ): Promise<SkillsSettings>;
  setHidden(
    runtimeId: RuntimeId | undefined,
    input: { path: string; skillName: string; hidden: boolean }
  ): Promise<SkillsSettings>;
  setPluginHidden(
    runtimeId: RuntimeId | undefined,
    input: { pluginId: string; skillName: string; hidden: boolean }
  ): Promise<SkillsSettings>;
  setAllPluginHidden(
    runtimeId: RuntimeId | undefined,
    pluginId: string,
    hidden: boolean
  ): Promise<SkillsSettings>;
  setAllHidden(
    runtimeId: RuntimeId | undefined,
    path: string,
    hidden: boolean
  ): Promise<SkillsSettings>;
  listAvailable(runtimeId?: RuntimeId): Promise<SkillInfo[]>;
  listPlugin(runtimeId?: RuntimeId): Promise<SkillInfo[]>;
  list(runtimeId: RuntimeId | undefined, path: string): Promise<SkillInfo[]>;
  read(runtimeId: RuntimeId | undefined, path: string): Promise<SkillContent>;
}
export type SkillsRpc = RpcShape<SkillsRequests>;
export const SKILLS_RPC = defineRpcNamespace<SkillsRpc>("skills", {
  streams: [],
  events: [],
});

export interface AgentExecutionStreams {
  stream(
    runtimeId: RuntimeId | undefined,
    request: AgentStreamRequest,
    options?: { connection?: ProviderConnectionRef; signal?: AbortSignal }
  ): AsyncIterable<AgentEvent>;
}
export type AgentExecutionRpc = RpcShape<
  Record<never, never>,
  AgentExecutionStreams
>;
export const AGENT_EXECUTION_RPC = defineRpcNamespace<AgentExecutionRpc>(
  "agentExecution",
  { streams: ["stream"], events: [] }
);
