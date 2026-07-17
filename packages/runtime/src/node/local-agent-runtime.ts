import { resolve } from "node:path";

import type { Models } from "@earendil-works/pi-ai";

import { loadAgentProject } from "./compiler/load-agent-project";
import {
  AgentRuntime,
  type CreateAgentSessionOptions
} from "../runtime/agent/agent-runtime";

import type { AgentSession } from "../runtime/sessions/agent-session";
import type { AgentSessionContext } from "../shared/agent-session-context";

export type CreateLocalAgentSessionOptions = {
  context?: AgentSessionContext;
} & Omit<CreateAgentSessionOptions, "context">;

export interface LocalAgentRuntimeOptions {
  agentRoot: string;
  models: Models;
}

export class LocalAgentRuntime {
  readonly agentRoot: string;

  private readonly _runtime: AgentRuntime;

  private constructor(agentRoot: string, runtime: AgentRuntime) {
    this.agentRoot = agentRoot;
    this._runtime = runtime;
  }

  static async create(
    options: LocalAgentRuntimeOptions
  ): Promise<LocalAgentRuntime> {
    const agentRoot = resolve(options.agentRoot);
    const runtime = new AgentRuntime({
      models: options.models,
      project: await loadAgentProject(agentRoot)
    });
    return new LocalAgentRuntime(agentRoot, runtime);
  }

  get project() {
    return this._runtime.project;
  }

  get defaultModel() {
    return this._runtime.defaultModel;
  }

  async createSession(
    options: CreateLocalAgentSessionOptions = {}
  ): Promise<AgentSession> {
    const id = options.context?.id
      ?? options.id
      ?? `session-${globalThis.crypto.randomUUID()}`;
    const principal = {
      issuer: "llm-space-local-runtime",
      principalId: "local-process",
      principalType: "runtime" as const
    };
    return this._runtime.createSession({
      ...options,
      context: options.context ?? {
        id,
        auth: { initiator: principal, current: principal },
        channel: { kind: "local-runtime" },
        turn: { id: `turn-${globalThis.crypto.randomUUID()}`, sequence: 1 }
      }
    });
  }
}
