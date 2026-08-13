import type { TokenResult } from "@llm-space/agent/connections";
import type { SandboxSession } from "@llm-space/agent/sandbox";
import type { SkillHandle } from "@llm-space/agent/skills";
import type {
  ToolAuthOptions,
  ToolAuthProvider,
  ToolContext,
} from "@llm-space/agent/tools";

export interface SandboxService {
  /** Return the durable workspace associated with one Engine Thread. */
  getOrCreate(input: {
    readonly agentId: string;
    readonly threadId: string;
    readonly signal: AbortSignal;
  }): Promise<SandboxSession>;
  /** Release resources after a Thread is explicitly removed or reset. */
  disposeThread?(threadId: string): Promise<void>;
  /** Release process-scoped backend resources. */
  close?(): Promise<void>;
}

export interface SkillService {
  /** Resolve a Skill explicitly mounted by the loaded Agent. */
  resolve(input: {
    readonly agentId: string;
    readonly threadId: string;
    readonly identifier: string;
  }): SkillHandle;
  /** Release process-scoped Skill resources. */
  close?(): Promise<void>;
}

export interface AuthorizationService {
  /** Return a usable token, or reject with a host-specific auth challenge. */
  getToken(
    provider: ToolAuthProvider,
    options: ToolAuthOptions | undefined,
    context: ToolRuntimeContext
  ): Promise<TokenResult>;
  /** Persist or surface an authorization challenge, then interrupt execution. */
  requireAuth(
    provider: ToolAuthProvider,
    options: ToolAuthOptions | undefined,
    context: ToolRuntimeContext
  ): never;
  /** Release process-scoped authorization resources. */
  close?(): Promise<void>;
}

export interface ConnectionService {
  /** Release process-scoped MCP/OpenAPI connections. */
  close(): Promise<void>;
}

export interface RuntimeServices {
  readonly authorization?: AuthorizationService;
  readonly connections?: ConnectionService;
  readonly sandbox?: SandboxService;
  readonly skills?: SkillService;
}

export interface ToolRuntimeContext {
  readonly agentId: string;
  readonly execution: ToolContext["execution"];
  readonly signal: AbortSignal;
}

/** Build the stable Agent ToolContext from explicitly injected host services. */
export function createRuntimeToolContext(
  services: RuntimeServices,
  context: ToolRuntimeContext
): ToolContext {
  return {
    execution: context.execution,
    abortSignal: context.signal,
    getSandbox() {
      const sandbox = services.sandbox;
      if (sandbox === undefined) {
        throw new Error(
          `Agent "${context.agentId}" requires a SandboxService for Thread "${context.execution.threadId}".`
        );
      }
      return sandbox.getOrCreate({
        agentId: context.agentId,
        threadId: context.execution.threadId,
        signal: context.signal,
      });
    },
    getSkill(identifier) {
      const skills = services.skills;
      if (skills === undefined) {
        throw new Error(
          `Agent "${context.agentId}" cannot resolve Skill "${identifier}" because no SkillService was provided.`
        );
      }
      return skills.resolve({
        agentId: context.agentId,
        threadId: context.execution.threadId,
        identifier,
      });
    },
    getToken(provider, options) {
      const authorization = services.authorization;
      if (authorization === undefined) {
        return Promise.reject(
          new Error(
            `Agent "${context.agentId}" cannot resolve credentials because no AuthorizationService was provided.`
          )
        );
      }
      return authorization.getToken(provider, options, context);
    },
    requireAuth(provider, options) {
      const authorization = services.authorization;
      if (authorization === undefined) {
        throw new Error(
          `Agent "${context.agentId}" cannot request authorization because no AuthorizationService was provided.`
        );
      }
      return authorization.requireAuth(provider, options, context);
    },
  };
}

/** Close each distinct process-scoped runtime service once. */
export async function closeRuntimeServices(
  services: RuntimeServices
): Promise<void> {
  const closeables = [
    services.connections,
    services.authorization,
    services.skills,
    services.sandbox,
  ].filter(
    (service): service is { close(): Promise<void> } =>
      service !== undefined && typeof service.close === "function"
  );
  await Promise.allSettled(
    [...new Set(closeables)].map((service) => service.close())
  );
}
