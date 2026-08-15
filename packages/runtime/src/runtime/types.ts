import type {
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
  ProviderProfilePatch,
  ProviderConnectionRef,
  SearchSettings,
  SkillContent,
  SkillInfo,
  SkillsSettings,
  SystemProxyDetection,
  Thread,
} from "@llm-space/core";

import type { RuntimeId } from "./runtime-id";

export type { RuntimeId };

export type RuntimeCapability =
  | "filesystem"
  | "models"
  | "mcp"
  | "builtinTools"
  | "skills"
  | "search"
  | "network";

export interface RuntimeInfo {
  id: RuntimeId;
  kind: "local";
  name: string;
  status: "connected" | "connecting" | "disconnected" | "error";
  capabilities: RuntimeCapability[];
}

export interface RuntimeScopedParams {
  runtimeId?: RuntimeId;
}

export interface UpdateProviderProfileInput extends ProviderProfilePatch {
  providerId: string;
  profileId: string;
}

export type MaybePromise<T> = T | Promise<T>;

export interface RuntimeClient {
  info(): RuntimeInfo;

  availableModels(): Promise<ModelProviderGroup[]>;
  removeProvider(providerId: string): Promise<ModelProviderGroup[]>;
  builtinProviders(): Promise<ModelProviderGroup[]>;
  addProvider(providerId: string): Promise<ModelProviderGroup[]>;
  addCustomProvider(input: {
    id: string;
    name: string;
    baseUrl: string;
    api?: "anthropic-messages" | "openai-completions" | "openai-responses";
  }): Promise<ModelProviderGroup[]>;
  addProviderProfile(providerId: string): Promise<ModelProviderGroup[]>;
  updateProviderProfile(
    input: UpdateProviderProfileInput
  ): Promise<ModelProviderGroup[]>;
  removeProviderProfile(input: {
    providerId: string;
    profileId: string;
  }): Promise<ModelProviderGroup[]>;
  updateProvider(input: {
    providerId: string;
    name?: string | null;
    api?:
      "anthropic-messages" | "openai-completions" | "openai-responses" | null;
    icon?: string | null;
    imageGeneration?: ArkImageGenerationConfig;
  }): Promise<ModelProviderGroup[]>;
  setModelEnabled(input: {
    providerId: string;
    modelId: string;
    enabled: boolean;
  }): Promise<ModelProviderGroup[]>;
  setAllModelsEnabled(input: {
    providerId: string;
    enabled: boolean;
  }): Promise<ModelProviderGroup[]>;
  getDefaultModel(): Promise<ModelConfig | null>;
  setDefaultModel(model: ModelConfig | null): Promise<ModelConfig | null>;
  resolveGeneratorEnv(input: {
    providerId: string;
    profileId?: string;
    envNames: string[];
  }): Promise<{ modelApiKey: string; envValues: Record<string, string> }>;
  testModelConnection(input: {
    providerId: string;
    profileId?: string;
    modelId: string;
    candidate?: CustomModel;
  }): Promise<void>;
  removeCustomModel(input: {
    providerId: string;
    modelId: string;
  }): Promise<ModelProviderGroup[]>;
  upsertCustomModel(input: {
    providerId: string;
    model: CustomModel;
    originalId?: string;
  }): Promise<ModelProviderGroup[]>;

  fsLs(path: string): Promise<FileNode[]>;
  fsMkdir(path: string): Promise<void>;
  fsCp(src: string, dest: string): Promise<void>;
  fsMv(src: string, dest: string): Promise<void>;
  fsRm(path: string): Promise<void>;
  fsRead(path: string): Promise<Thread>;
  fsWrite(path: string, thread: Thread): Promise<void>;
  fsRealpath(path: string): Promise<string>;
  /** Read arbitrary prompt text (`~` expands on this runtime). */
  readTextFile(path: string): Promise<string>;
  /** Whether prompt text is a readable regular file on this runtime. */
  textFileExists(path: string): Promise<boolean>;

  mcpListServers(): McpServerView[] | Promise<McpServerView[]>;
  mcpAddServer(
    server: McpServerDraft
  ): McpServerView[] | Promise<McpServerView[]>;
  mcpUpdateServer(
    serverId: string,
    server: McpServerDraft
  ): Promise<McpServerView[]>;
  mcpRemoveServer(serverId: string): Promise<McpServerView[]>;
  mcpDisconnectServer(serverId: string): Promise<McpServerView[]>;
  mcpCancelTest(serverId: string): Promise<McpServerView[]>;
  mcpListTools(serverId: string): Promise<McpServerToolsResponse>;
  mcpCallTool(input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  }): Promise<McpCallToolResponse>;

  builtInListTools(): MaybePromise<BuiltinTool[]>;
  builtInCallTool(input: {
    name: string;
    arguments: Record<string, unknown>;
    config?: Record<string, unknown>;
    connection?: ProviderConnectionRef;
  }): Promise<BuiltinToolCallResponse>;

  getSearchSettings(): MaybePromise<SearchSettings>;
  setSearchSettings(settings: SearchSettings): MaybePromise<SearchSettings>;
  getNetworkSettings(): MaybePromise<NetworkSettings>;
  setNetworkSettings(settings: NetworkSettings): MaybePromise<NetworkSettings>;
  detectSystemProxy(): MaybePromise<SystemProxyDetection>;

  skillsGetSettings(): MaybePromise<SkillsSettings>;
  skillsAddPath(path: string): MaybePromise<SkillsSettings>;
  skillsRemovePath(path: string): MaybePromise<SkillsSettings>;
  skillsSetSkillHidden(input: {
    path: string;
    skillName: string;
    hidden: boolean;
  }): MaybePromise<SkillsSettings>;
  skillsSetAllSkillsHidden(input: {
    path: string;
    hidden: boolean;
  }): MaybePromise<SkillsSettings>;
  skillsListAvailable(): MaybePromise<SkillInfo[]>;
  skillsListSkills(path: string): MaybePromise<SkillInfo[]>;
  skillsReadSkill(path: string): MaybePromise<SkillContent>;

}
