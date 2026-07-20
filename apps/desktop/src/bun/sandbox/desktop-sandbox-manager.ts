import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DockerSandboxProvider,
  SandboxWorkspaceLostError
} from "@llm-space/runtime/node";

import type {
  CompiledSandboxWorkspaceFile,
  SandboxAttachmentInput,
  SandboxProvider,
  SandboxTurnEnvironment,
  StagedSandboxAttachment
} from "@llm-space/runtime/node";

import type { ExternalAgentProjectRuntimeStatus } from "../../shared/external-agent-project";

interface SandboxRegistryRecord {
  readonly state: "active" | "cleanupPending" | "lost";
}

interface SandboxRegistry {
  readonly schemaVersion: 1;
  readonly sessions: Record<string, SandboxRegistryRecord>;
}

export class DesktopSandboxManager {
  private readonly _provider: SandboxProvider;
  private readonly _registryFile: string;
  private _registry: SandboxRegistry = { schemaVersion: 1, sessions: {} };

  constructor(options: {
    readonly homePath: string;
    readonly provider?: SandboxProvider;
  }) {
    this._provider = options.provider ?? new DockerSandboxProvider();
    this._registryFile = path.join(
      options.homePath,
      "sandboxes",
      "registry.json"
    );
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this._registryFile), {
      recursive: true,
      mode: 0o700
    });
    this._registry = await this._loadRegistry();
    for (const [sessionId, record] of Object.entries(this._registry.sessions)) {
      if (record.state !== "cleanupPending") { continue; }
      try {
        await this._provider.delete(sessionId);
        this._deleteRecord(sessionId);
        await this._saveRegistry();
      } catch {
        // The durable tombstone is retried on the next start or explicit delete.
      }
    }
  }

  async status(sessionId: string): Promise<ExternalAgentProjectRuntimeStatus> {
    const record = this._registry.sessions[sessionId];
    if (record?.state === "lost") {
      return {
        state: "unavailable",
        message: "The Sandbox workspace is missing. Create a new Thread."
      };
    }
    if (record?.state === "cleanupPending") {
      return {
        state: "unavailable",
        message: "Sandbox cleanup is pending. Create a new Thread."
      };
    }
    const readiness = await this._provider.readiness();
    return readiness.state === "ready"
      ? { state: "ready" }
      : { state: "unavailable", message: readiness.message };
  }

  async prepareTurn(input: {
    readonly attachments?: readonly SandboxAttachmentInput[];
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
    readonly turnId: string;
  }): Promise<{
    readonly attachments: readonly StagedSandboxAttachment[];
  } & SandboxTurnEnvironment> {
    const record = this._registry.sessions[input.sessionId];
    if (record?.state === "lost") { throw new SandboxWorkspaceLostError(); }
    if (record?.state === "cleanupPending") {
      throw new Error("Sandbox cleanup is pending");
    }
    try {
      const session = await this._provider.acquire({
        expectedExisting: record?.state === "active",
        seed: input.seed,
        sessionId: input.sessionId
      });
      if (!record) {
        this._registry = {
          ...this._registry,
          sessions: {
            ...this._registry.sessions,
            [input.sessionId]: { state: "active" }
          }
        };
        await this._saveRegistry();
      }
      const attachments = input.attachments?.length
        ? await session.stageTurn({
          attachments: input.attachments,
          turnId: input.turnId
        })
        : [];
      return {
        executionEnv: session.executionEnv,
        workspaceManifest: await session.workspaceManifest(),
        attachments
      };
    } catch (error) {
      if (error instanceof SandboxWorkspaceLostError) {
        this._registry = {
          ...this._registry,
          sessions: {
            ...this._registry.sessions,
            [input.sessionId]: { state: "lost" }
          }
        };
        await this._saveRegistry();
      }
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    if (!this._registry.sessions[sessionId]) { return; }
    this._registry = {
      ...this._registry,
      sessions: {
        ...this._registry.sessions,
        [sessionId]: { state: "cleanupPending" }
      }
    };
    await this._saveRegistry();
    await this._provider.delete(sessionId);
    this._deleteRecord(sessionId);
    await this._saveRegistry();
  }

  async stop(): Promise<void> {
    const active = Object.entries(this._registry.sessions)
      .filter(([, record]) => record.state === "active")
      .map(([sessionId]) => sessionId);
    const results = await Promise.allSettled(
      active.map(async sessionId => this._provider.stop(sessionId))
    );
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failed) { throw failed.reason; }
  }

  private _deleteRecord(sessionId: string): void {
    const sessions = Object.fromEntries(
      Object.entries(this._registry.sessions)
        .filter(([candidate]) => candidate !== sessionId)
    );
    this._registry = { ...this._registry, sessions };
  }

  private async _loadRegistry(): Promise<SandboxRegistry> {
    try {
      const value = JSON.parse(await readFile(this._registryFile, "utf8")) as
        Partial<SandboxRegistry>;
      if (
        value.schemaVersion !== 1
        || !value.sessions
        || typeof value.sessions !== "object"
        || Array.isArray(value.sessions)
      ) {
        throw new TypeError("Sandbox registry is invalid");
      }
      return {
        schemaVersion: 1,
        sessions: Object.fromEntries(
          Object.entries(value.sessions).filter((entry): entry is [
            string,
            SandboxRegistryRecord
          ] => Boolean(
            entry[0]
            && entry[1]
            && (entry[1].state === "active"
              || entry[1].state === "cleanupPending"
              || entry[1].state === "lost")
          ))
        )
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { schemaVersion: 1, sessions: {} };
      }
      throw error;
    }
  }

  private async _saveRegistry(): Promise<void> {
    const temporary = `${this._registryFile}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(this._registry, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await rename(temporary, this._registryFile);
  }
}
