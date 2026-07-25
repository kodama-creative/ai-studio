import path from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  AgentServerClientError,
  createAgentServerClient,
  generateContinuationToken
} from "@llm-space/runtime/client";
import {
  createStaticBearerAuthenticator,
  revokeStoredServerContinuation,
  startAgentServer,
  type StartedAgentServer
} from "@llm-space/server";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import type { ThreadServerRunLineage } from "@llm-space/core";
import type {
  AgentServerRuntimeProjection,
  AgentServerRuntimeWorkingBase,
  ServerRunTerminalOutcome
} from "@llm-space/runtime/client";
import type { StoredRuntimeSession } from "@llm-space/runtime/harness";
import type { SandboxProvider } from "@llm-space/runtime/server";

import { LocalServerCredentialStore } from "./local-server-credential-store";

import type { ExternalAgentProjectManager } from "../external-projects";

export type EmbeddedLocalServerState =
  | "preparing"
  | "ready"
  | "reconnecting"
  | "running"
  | "stale"
  | "unavailable";

export interface EmbeddedLocalServerStatus {
  readonly message?: string;
  readonly state: EmbeddedLocalServerState;
}

export interface EmbeddedLocalServerRunCallbacks {
  readonly onEvent: (event: AgentEvent) => void;
  readonly onLineage: (lineage: ThreadServerRunLineage) => void;
  readonly onStatus: (status: EmbeddedLocalServerStatus) => void;
  readonly onTerminal: (
    lineage: ThreadServerRunLineage,
    outcome: ServerRunTerminalOutcome,
    code?: string,
    runtime?: AgentServerRuntimeProjection
  ) => void;
}

interface ManagedServer {
  readonly client: ReturnType<typeof createAgentServerClient>;
  readonly server: StartedAgentServer;
}

/** Process owner for protected per-artifact Desktop loopback Servers. */
export class EmbeddedLocalServerManager {
  private readonly _accessKey = generateContinuationToken();
  private readonly _credentials: LocalServerCredentialStore;
  private readonly _models: Models;
  private readonly _principalId: string;
  private readonly _servers = new Map<string, Promise<ManagedServer>>();

  constructor(
    private readonly _options: {
      externalAgentProjects: ExternalAgentProjectManager;
      homePath: string;
      models?: Models;
      sandboxProvider?: SandboxProvider;
    }
  ) {
    this._credentials = new LocalServerCredentialStore(_options.homePath);
    this._models = _options.models ?? builtinModels();
    this._principalId = `local-${
      typeof process.getuid === "function" ? process.getuid() : "user"
    }`;
  }

  async status(
    projectId: string,
    threadId: string
  ): Promise<EmbeddedLocalServerStatus> {
    const [project, record] = await Promise.all([
      this._options.externalAgentProjects.inspect(projectId),
      this._options.externalAgentProjects.readThread(projectId, threadId)
    ]);
    const profile = record.thread.runtimeProfile;
    if (profile?.type !== "localServer") {
      return { state: "ready" };
    }
    if (
      !project.artifactFingerprint
      || project.artifactFingerprint !== profile.artifactFingerprint
    ) {
      return {
        state: "stale",
        message: "This Thread is bound to an older compiled Agent artifact."
      };
    }
    if (project.sandboxRequired) {
      const readiness = await this._options.sandboxProvider?.readiness();
      if (readiness?.state !== "ready") {
        return {
          state: "unavailable",
          message: readiness?.state === "unavailable"
            ? readiness.message
            : "The Local Server Host has no SandboxProvider."
        };
      }
    }
    if (profile.serverSessionId) {
      let credential;
      try {
        credential = await this._credentials.get(projectId, threadId);
      } catch {
        return {
          state: "unavailable",
          message: "The Local Server credential registry is unavailable."
        };
      }
      if (
        credential?.sessionId !== profile.serverSessionId
        || credential?.artifactFingerprint !== profile.artifactFingerprint
        || Date.parse(credential?.expiresAt ?? "") <= Date.now()
      ) {
        return {
          state: "unavailable",
          message: "The Local Server continuation credential is unavailable or expired."
        };
      }
    }
    return { state: "ready" };
  }

  async run(
    input: {
      readonly outputContract?: string;
      readonly projectId: string;
      readonly signal: AbortSignal;
      readonly text: string;
      readonly threadId: string;
      readonly workingBase?: AgentServerRuntimeWorkingBase;
    },
    callbacks: EmbeddedLocalServerRunCallbacks
  ): Promise<void> {
    callbacks.onStatus({ state: "preparing" });
    const record = await this._options.externalAgentProjects.readThread(
      input.projectId,
      input.threadId
    );
    const profile = record.thread.runtimeProfile;
    if (profile?.type !== "localServer") {
      throw new Error("Thread is not bound to the Local Server Runtime Profile.");
    }
    const status = await this.status(input.projectId, input.threadId);
    if (status.state !== "ready") {
      callbacks.onStatus(status);
      throw new Error(status.message ?? "Local Server is unavailable.");
    }

    let managed: ManagedServer;
    try {
      managed = await this._server(
        input.projectId,
        profile.artifactFingerprint
      );
    } catch (error) {
      const unavailable = {
        state: "unavailable" as const,
        message: "The Local Server could not start. Verify its Host model credentials and try again."
      };
      callbacks.onStatus(unavailable);
      throw new Error(unavailable.message, { cause: error });
    }
    callbacks.onStatus({ state: "ready" });
    let credential = await this._credentials.get(
      input.projectId,
      input.threadId
    );
    if (credential && credential.artifactFingerprint !== profile.artifactFingerprint) {
      throw new Error("Stored Local Server credential belongs to another artifact.");
    }
    if (profile.serverSessionId) {
      if (credential?.sessionId !== profile.serverSessionId) {
        throw new Error("Local Server continuation credential is unavailable.");
      }
    } else if (credential) {
      await this._options.externalAgentProjects.bindLocalServerSession(
        input.projectId,
        input.threadId,
        {
          artifactFingerprint: profile.artifactFingerprint,
          sessionId: credential.sessionId
        }
      );
    } else {
      const session = await managed.client.createSession();
      credential = {
        artifactFingerprint: profile.artifactFingerprint,
        continuationToken: session.continuationToken,
        expiresAt: session.continuation.expiresAt,
        projectId: input.projectId,
        sessionId: session.sessionId,
        threadId: input.threadId
      };
      await this._credentials.set(credential);
      try {
        await this._options.externalAgentProjects.bindLocalServerSession(
          input.projectId,
          input.threadId,
          {
            artifactFingerprint: profile.artifactFingerprint,
            sessionId: session.sessionId
          }
        );
      } catch (error) {
        await managed.client.revokeContinuation({
          continuationToken: session.continuationToken,
          sessionId: session.sessionId
        }).catch(() => {});
        await this._credentials.delete(input.projectId, input.threadId);
        throw error;
      }
    }

    const run = await managed.client.createRun({
      continuationToken: credential.continuationToken,
      sessionId: credential.sessionId,
      text: input.text,
      ...(input.workingBase ? { workingBase: input.workingBase } : {}),
      ...(input.outputContract
        ? { outputContract: input.outputContract }
        : {})
    });
    const lineage: ThreadServerRunLineage = {
      profile: "localServer",
      artifactFingerprint: profile.artifactFingerprint,
      sessionId: run.sessionId,
      runId: run.runId
    };
    callbacks.onLineage(lineage);
    callbacks.onStatus({ state: "running" });

    let terminalOutcome: ServerRunTerminalOutcome | null = null;
    const abortState: {
      request: ReturnType<typeof managed.client.abortRun> | null;
    } = { request: null };
    let terminalCode: string | undefined;
    let terminalRuntime: AgentServerRuntimeProjection | undefined;
    let abortSettlementError: Error | null = null;
    const abort = () => {
      abortState.request = abortState.request ?? managed.client.abortRun({
        continuationToken: credential.continuationToken,
        sessionId: run.sessionId,
        runId: run.runId
      });
    };
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) {
      abort();
    }
    try {
      const stream = managed.client.streamRun({
        continuationToken: credential.continuationToken,
        onConnectionStateChange: state => {
          callbacks.onStatus({
            state: state === "connected" ? "running" : "reconnecting"
          });
        },
        sessionId: run.sessionId,
        runId: run.runId,
        signal: input.signal
      });
      for await (const event of stream) {
        if (event.event === "pi") {
          callbacks.onEvent(event.data);
        } else if (event.data.type === "serverShutdown") {
          callbacks.onStatus({ state: "reconnecting" });
        } else if (event.data.type === "toolApprovalRequired") {
          callbacks.onStatus({
            state: "ready",
            message: `${event.data.approvals.length} tool approval${event.data.approvals.length === 1 ? "" : "s"} required`
          });
        } else {
          terminalOutcome = event.data.outcome;
          terminalCode = event.data.code;
          terminalRuntime = event.data.runtime;
          callbacks.onTerminal(
            lineage,
            terminalOutcome,
            terminalCode,
            terminalRuntime
          );
        }
      }
    } finally {
      input.signal.removeEventListener("abort", abort);
      const abortResult = await abortState.request?.catch(() => null);
      if (input.signal.aborted && !terminalOutcome) {
        if (abortResult?.status === "terminal") {
          terminalOutcome = abortResult.outcome;
        }
        try {
          for await (const event of managed.client.streamRun({
            continuationToken: credential.continuationToken,
            sessionId: run.sessionId,
            runId: run.runId
          })) {
            if (event.event === "control" && event.data.type === "runTerminal") {
              terminalOutcome = event.data.outcome;
              terminalCode = event.data.code;
              terminalRuntime = event.data.runtime;
              break;
            }
          }
        } catch (error) {
          if (!terminalOutcome) {
            abortSettlementError = error instanceof Error
              ? error
              : new Error("Unable to read the Local Server terminal event");
          }
        }
        if (!abortSettlementError) {
          callbacks.onTerminal(
            lineage,
            terminalOutcome ?? "cancelled",
            terminalCode,
            terminalRuntime
          );
        }
      }
    }
    if (abortSettlementError) { throw abortSettlementError; }
  }

  async renameBranch(input: {
    readonly branchId: string;
    readonly label: string;
    readonly projectId: string;
    readonly threadId: string;
  }): Promise<StoredRuntimeSession> {
    const record = await this._options.externalAgentProjects.readThread(
      input.projectId,
      input.threadId
    );
    const profile = record.thread.runtimeProfile;
    if (profile?.type !== "localServer" || !profile.serverSessionId) {
      throw new Error("Thread is not bound to a Local Server Session.");
    }
    const credential = await this._credentials.get(
      input.projectId,
      input.threadId
    );
    if (
      credential?.sessionId !== profile.serverSessionId
      || credential?.artifactFingerprint !== profile.artifactFingerprint
    ) {
      throw new Error("Local Server continuation credential is unavailable.");
    }
    const managed = await this._server(
      input.projectId,
      profile.artifactFingerprint
    );
    return managed.client.renameBranch({
      branchId: input.branchId,
      continuationToken: credential.continuationToken,
      label: input.label,
      sessionId: credential.sessionId
    });
  }

  async detachThread(projectId: string, threadId: string): Promise<void> {
    const credential = await this._credentials.get(projectId, threadId);
    if (!credential) {
      return;
    }
    try {
      const managed = await this._servers.get(credential.artifactFingerprint);
      if (managed) {
        await managed.client.revokeContinuation({
          continuationToken: credential.continuationToken,
          sessionId: credential.sessionId
        });
      } else {
        await revokeStoredServerContinuation({
          artifactFingerprint: credential.artifactFingerprint,
          continuationToken: credential.continuationToken,
          owner: {
            issuer: "llm-space-desktop",
            principalId: this._principalId,
            principalType: "user"
          },
          repositoryRoot: path.join(
            this._options.homePath,
            "servers",
            credential.artifactFingerprint
          ),
          sessionId: credential.sessionId
        });
      }
    } catch (error) {
      if (!(error instanceof AgentServerClientError && error.status === 404)) {
        throw error;
      }
    }
    await this._options.sandboxProvider?.delete(credential.sessionId);
    await this._credentials.delete(projectId, threadId);
  }

  async shutdown(): Promise<void> {
    const servers = await Promise.allSettled(this._servers.values());
    this._servers.clear();
    await Promise.allSettled(
      servers.flatMap(result =>
        (result.status === "fulfilled" ? [result.value.server.stop()] : []))
    );
  }

  private async _server(
    projectId: string,
    artifactFingerprint: string
  ): Promise<ManagedServer> {
    const existing = this._servers.get(artifactFingerprint);
    if (existing) {
      return existing;
    }
    const starting = this._startServer(projectId, artifactFingerprint);
    this._servers.set(artifactFingerprint, starting);
    void starting.catch(() => {
      if (this._servers.get(artifactFingerprint) === starting) {
        this._servers.delete(artifactFingerprint);
      }
    });
    return starting;
  }

  private async _startServer(
    projectId: string,
    artifactFingerprint: string
  ): Promise<ManagedServer> {
    const project = await this._options.externalAgentProjects.getCompiledProject(
      projectId,
      artifactFingerprint
    );
    const server = await startAgentServer({
      artifactFingerprint,
      project,
      models: this._models,
      authenticator: createStaticBearerAuthenticator([{
        issuer: "llm-space-desktop",
        principalId: this._principalId,
        principalType: "user",
        token: this._accessKey
      }]),
      hostname: "127.0.0.1",
      port: 0,
      localDev: true,
      repositoryRoot: path.join(
        this._options.homePath,
        "servers",
        artifactFingerprint
      ),
      ...(this._options.sandboxProvider
        ? { sandboxProvider: this._options.sandboxProvider }
        : {})
    });
    return {
      server,
      client: createAgentServerClient({
        baseUrl: server.url,
        authorization: this._accessKey
      })
    };
  }
}
