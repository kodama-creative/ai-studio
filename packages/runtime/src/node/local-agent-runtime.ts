import { resolve } from "node:path";

import type { Models } from "@earendil-works/pi-ai";

import {
  AgentRuntime,
  type CreateAgentRuntimeSessionOptions,
} from "../agent-runtime";
import type { AgentRuntimeSession } from "../agent-runtime-session";

import { loadAgentProject } from "./project-loader";

export interface LocalAgentRuntimeOptions {
  agentRoot: string;
  models: Models;
}

export class LocalAgentRuntime {
  readonly agentRoot: string;

  private readonly _runtime: AgentRuntime;

  static async create(
    options: LocalAgentRuntimeOptions
  ): Promise<LocalAgentRuntime> {
    const agentRoot = resolve(options.agentRoot);
    const runtime = await AgentRuntime.create({
      models: options.models,
      loadProject: () => loadAgentProject(agentRoot),
    });
    return new LocalAgentRuntime(agentRoot, runtime);
  }

  private constructor(agentRoot: string, runtime: AgentRuntime) {
    this.agentRoot = agentRoot;
    this._runtime = runtime;
  }

  get project() {
    return this._runtime.project;
  }

  get defaultModel() {
    return this._runtime.defaultModel;
  }

  createSession(
    options: CreateAgentRuntimeSessionOptions = {}
  ): Promise<AgentRuntimeSession> {
    return this._runtime.createSession(options);
  }
}
