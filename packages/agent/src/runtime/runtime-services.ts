import type { TokenResult } from "../connections";
import type { SandboxSession } from "../sandbox";
import type { SkillHandle } from "../skills";
import type {
  ToolAuthOptions,
  ToolAuthProvider,
  ToolContext,
} from "../tools";

export interface SandboxService {
  /** Returns the durable workspace associated with one Pi Session. */
  getOrCreate(input: {
    readonly agentId: string;
    readonly sessionId: string;
    readonly signal: AbortSignal;
  }): Promise<SandboxSession>;
  disposeSession?(sessionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface SkillService {
  /** Resolves one Skill explicitly mounted by the loaded Agent. */
  resolve(input: {
    readonly agentId: string;
    readonly sessionId: string;
    readonly identifier: string;
  }): SkillHandle;
  close?(): Promise<void>;
}

export interface ToolRuntimeContext {
  readonly agentId: string;
  readonly execution: ToolContext["execution"];
  readonly signal: AbortSignal;
}

export interface AuthorizationService {
  getToken(
    provider: ToolAuthProvider,
    options: ToolAuthOptions | undefined,
    context: ToolRuntimeContext
  ): Promise<TokenResult>;
  requireAuth(
    provider: ToolAuthProvider,
    options: ToolAuthOptions | undefined,
    context: ToolRuntimeContext
  ): never;
  close?(): Promise<void>;
}

export interface ConnectionService {
  close(): Promise<void>;
}

/** Host-owned capabilities available to authored Agent tools. */
export interface RuntimeServices {
  readonly authorization?: AuthorizationService;
  readonly connections?: ConnectionService;
  readonly sandbox?: SandboxService;
  readonly skills?: SkillService;
}

/** Builds the authored ToolContext from explicitly injected host services. */
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
          `Agent "${context.agentId}" requires a SandboxService for Session "${context.execution.sessionId}".`
        );
      }
      return sandbox.getOrCreate({
        agentId: context.agentId,
        sessionId: context.execution.sessionId,
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
        sessionId: context.execution.sessionId,
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

/** Closes each distinct process-scoped host service once. */
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
