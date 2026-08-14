import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  AGENT_EXECUTION_RPC,
  BUILTIN_TOOLS_RPC,
  MCP_RPC,
  MODELS_RPC,
  NETWORK_RPC,
  PROMPT_FILES_RPC,
  RUNTIMES_RPC,
  SEARCH_RPC,
  SKILLS_RPC,
  WORKSPACE_RPC,
  type AgentExecutionRpc,
  type AgentExecutionStreams,
  type BuiltinToolsRequests,
  type BuiltinToolsRpc,
  type McpRequests,
  type McpRpc,
  type ModelsRequests,
  type ModelsRpc,
  type NetworkRequests,
  type NetworkRpc,
  type PromptFilesRequests,
  type PromptFilesRpc,
  type RuntimesRequests,
  type RuntimesRpc,
  type SearchRequests,
  type SearchRpc,
  type SkillsRequests,
  type SkillsRpc,
  type WorkspaceRequests,
  type WorkspaceRpc,
} from "../../shared/runtime-rpc";
import type {
  AgentExecutionApplication,
  BuiltinToolsApplication,
  McpApplication,
  ModelsApplication,
  NetworkApplication,
  PromptFilesApplication,
  RuntimesApplication,
  SearchApplication,
  SkillsApplication,
  WorkspaceApplication,
} from "../application/runtime-applications";

/** Typed transport adapter for Runtime discovery and default selection. */
export class RuntimesRpcServer implements RpcServer<RuntimesRpc> {
  readonly namespace = RUNTIMES_RPC;
  readonly requests: RuntimesRequests;
  readonly streams = {};
  constructor(application: RuntimesApplication) { this.requests = application; }
}

/** Typed transport adapter for model configuration capabilities. */
export class ModelsRpcServer implements RpcServer<ModelsRpc> {
  readonly namespace = MODELS_RPC;
  readonly requests: ModelsRequests;
  readonly streams = {};
  constructor(application: ModelsApplication) { this.requests = application; }
}

/** Typed transport adapter for Runtime workspace storage. */
export class WorkspaceRpcServer implements RpcServer<WorkspaceRpc> {
  readonly namespace = WORKSPACE_RPC;
  readonly requests: WorkspaceRequests;
  readonly streams = {};
  constructor(application: WorkspaceApplication) { this.requests = application; }
}

/** Typed transport adapter for prompt-file reads. */
export class PromptFilesRpcServer implements RpcServer<PromptFilesRpc> {
  readonly namespace = PROMPT_FILES_RPC;
  readonly requests: PromptFilesRequests;
  readonly streams = {};
  constructor(application: PromptFilesApplication) { this.requests = application; }
}

/** Typed transport adapter for MCP configuration and tool calls. */
export class McpRpcServer implements RpcServer<McpRpc> {
  readonly namespace = MCP_RPC;
  readonly requests: McpRequests;
  readonly streams = {};
  constructor(application: McpApplication) { this.requests = application; }
}

/** Typed transport adapter for bundled tool calls. */
export class BuiltinToolsRpcServer implements RpcServer<BuiltinToolsRpc> {
  readonly namespace = BUILTIN_TOOLS_RPC;
  readonly requests: BuiltinToolsRequests;
  readonly streams = {};
  constructor(application: BuiltinToolsApplication) { this.requests = application; }
}

/** Typed transport adapter for search settings. */
export class SearchRpcServer implements RpcServer<SearchRpc> {
  readonly namespace = SEARCH_RPC;
  readonly requests: SearchRequests;
  readonly streams = {};
  constructor(application: SearchApplication) { this.requests = application; }
}

/** Typed transport adapter for network settings. */
export class NetworkRpcServer implements RpcServer<NetworkRpc> {
  readonly namespace = NETWORK_RPC;
  readonly requests: NetworkRequests;
  readonly streams = {};
  constructor(application: NetworkApplication) { this.requests = application; }
}

/** Typed transport adapter for Skill discovery and settings. */
export class SkillsRpcServer implements RpcServer<SkillsRpc> {
  readonly namespace = SKILLS_RPC;
  readonly requests: SkillsRequests;
  readonly streams = {};
  constructor(application: SkillsApplication) { this.requests = application; }
}

/** Transitional typed stream adapter for legacy Thread execution. */
export class AgentExecutionRpcServer implements RpcServer<AgentExecutionRpc> {
  readonly namespace = AGENT_EXECUTION_RPC;
  readonly requests = {};
  readonly streams: AgentExecutionStreams;
  constructor(application: AgentExecutionApplication) { this.streams = application; }
}
