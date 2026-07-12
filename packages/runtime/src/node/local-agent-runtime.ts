import { resolve } from "node:path";

import {
  JsonlSessionRepo,
  NodeExecutionEnv,
  type AgentTool,
  type JsonlSessionMetadata,
} from "@earendil-works/pi-agent-core/node";
import type { Models } from "@earendil-works/pi-ai";

import {
  AgentRuntime,
  type AgentModelSelector,
  type AgentRuntimeSession,
} from "../agent-runtime";

import { loadAgentProject } from "./project-loader";

export interface LocalAgentRuntimeOptions {
  agentRoot: string;
  sessionsRoot: string;
  models: Models;
}

export class LocalAgentRuntime {
  readonly agentRoot: string;
  readonly sessionsRoot: string;

  private readonly _env: NodeExecutionEnv;
  private readonly _repo: JsonlSessionRepo;
  private readonly _runtime: AgentRuntime;

  constructor(options: LocalAgentRuntimeOptions) {
    this.agentRoot = resolve(options.agentRoot);
    this.sessionsRoot = resolve(options.sessionsRoot);
    this._env = new NodeExecutionEnv({ cwd: this.agentRoot });
    this._repo = new JsonlSessionRepo({
      fs: this._env,
      sessionsRoot: this.sessionsRoot,
    });
    this._runtime = new AgentRuntime({
      env: this._env,
      models: options.models,
    });
  }

  listSessions(): Promise<JsonlSessionMetadata[]> {
    return this._repo.list({ cwd: this.agentRoot });
  }

  async createSession(options: {
    model: AgentModelSelector;
    id?: string;
    extraTools?: AgentTool[];
    instructionsPrefix?: string;
  }): Promise<AgentRuntimeSession> {
    const session = await this._repo.create({
      id: options.id,
      cwd: this.agentRoot,
    });
    return this._runtime.createSession({
      session,
      model: options.model,
      loadProject: () => loadAgentProject(this.agentRoot),
      extraTools: options.extraTools,
      instructionsPrefix: options.instructionsPrefix,
    });
  }

  async openSession(options: {
    metadata: JsonlSessionMetadata;
    model: AgentModelSelector;
    extraTools?: AgentTool[];
    instructionsPrefix?: string;
  }): Promise<AgentRuntimeSession> {
    const session = await this._repo.open(options.metadata);
    return this._runtime.createSession({
      session,
      model: options.model,
      loadProject: () => loadAgentProject(this.agentRoot),
      extraTools: options.extraTools,
      instructionsPrefix: options.instructionsPrefix,
    });
  }

  deleteSession(metadata: JsonlSessionMetadata): Promise<void> {
    return this._repo.delete(metadata);
  }

  async forkSession(options: {
    metadata: JsonlSessionMetadata;
    model: AgentModelSelector;
    id?: string;
    entryId?: string;
    position?: "before" | "at";
    extraTools?: AgentTool[];
    instructionsPrefix?: string;
  }): Promise<AgentRuntimeSession> {
    const session = await this._repo.fork(options.metadata, {
      id: options.id,
      entryId: options.entryId,
      position: options.position,
      cwd: this.agentRoot,
    });
    return this._runtime.createSession({
      session,
      model: options.model,
      loadProject: () => loadAgentProject(this.agentRoot),
      extraTools: options.extraTools,
      instructionsPrefix: options.instructionsPrefix,
    });
  }

  cleanup(): Promise<void> {
    return this._env.cleanup();
  }
}
