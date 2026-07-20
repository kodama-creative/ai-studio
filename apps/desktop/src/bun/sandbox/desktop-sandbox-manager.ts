import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sameSandboxAttachmentDescriptor } from "@llm-space/core";
import { SandboxWorkspaceLostError } from "@llm-space/runtime/node";

import type { SandboxAttachmentDescriptor } from "@llm-space/core";
import type {
  CompiledSandboxWorkspaceFile,
  SandboxAttachmentInput,
  SandboxProvider,
  SandboxProviderReadiness,
  SandboxProviderSession,
  SandboxTurnEnvironment,
  StagedSandboxAttachment
} from "@llm-space/runtime/node";

import type { ExternalAgentProjectRuntimeStatus } from "../../shared/external-agent-project";

interface SandboxRegistryRecord {
  readonly pendingAttachments?: Record<string, SandboxAttachmentTransaction>;
  readonly state: "active" | "cleanupPending" | "lost";
}

interface SandboxAttachmentTransaction {
  readonly attachments?: readonly StagedSandboxAttachment[];
  readonly stagingId: string;
  readonly turnId: string;
}

interface SandboxRegistry {
  readonly schemaVersion: 1;
  readonly sessions: Record<string, SandboxRegistryRecord>;
}

export class DesktopSandboxManager implements SandboxProvider {
  private readonly _provider: SandboxProvider;
  private readonly _registryFile: string;
  private _registry: SandboxRegistry = { schemaVersion: 1, sessions: {} };

  constructor(options: {
    readonly homePath: string;
    readonly provider: SandboxProvider;
  }) {
    this._provider = options.provider;
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
    return this.readiness();
  }

  async readiness(): Promise<SandboxProviderReadiness> {
    const readiness = await this._provider.readiness();
    return readiness.state === "ready"
      ? { state: "ready" }
      : { state: "unavailable", message: readiness.message };
  }

  async prepareTurn(input: {
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
    readonly turnId: string;
  }): Promise<SandboxTurnEnvironment> {
    if (this._hasPendingAttachments(input.sessionId)) {
      throw new Error("Sandbox attachment staging is incomplete.");
    }
    const session = await this.acquire(input);
    return {
      executionEnv: session.executionEnv,
      workspaceManifest: await session.workspaceManifest()
    };
  }

  async stageAttachments(input: {
    readonly attachments: readonly SandboxAttachmentInput[];
    readonly messageId: string;
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
    readonly turnId: string;
  }): Promise<readonly StagedSandboxAttachment[]> {
    const session = await this.acquire(input);
    const previous = this._registry.sessions[input.sessionId]
      ?.pendingAttachments?.[input.messageId];
    if (previous) {
      await session.discardTurn({
        stagingId: previous.stagingId,
        turnId: previous.turnId
      });
    }
    const stagingId = randomUUID();
    await this._setPendingAttachment(input.sessionId, input.messageId, {
      stagingId,
      turnId: input.turnId
    });
    try {
      const attachments = await session.stageTurn({
        attachments: input.attachments,
        stagingId,
        turnId: input.turnId
      });
      await this._setPendingAttachment(input.sessionId, input.messageId, {
        attachments,
        stagingId,
        turnId: input.turnId
      });
      return attachments;
    } catch (error) {
      try {
        await session.discardTurn({ stagingId, turnId: input.turnId });
        await this._clearPendingAttachment(input.sessionId, input.messageId);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Sandbox attachment staging and cleanup failed."
        );
      }
      throw error;
    }
  }

  async abortAttachmentStaging(input: {
    readonly messageId: string;
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
  }): Promise<void> {
    const pending = this._registry.sessions[input.sessionId]
      ?.pendingAttachments?.[input.messageId];
    if (!pending) { return; }
    const session = await this.acquire(input);
    await session.discardTurn({
      stagingId: pending.stagingId,
      turnId: pending.turnId
    });
    await this._clearPendingAttachment(input.sessionId, input.messageId);
  }

  async completeAttachmentStaging(input: {
    readonly attachments: readonly StagedSandboxAttachment[];
    readonly messageId: string;
    readonly sessionId: string;
  }): Promise<void> {
    const pending = this._registry.sessions[input.sessionId]
      ?.pendingAttachments?.[input.messageId];
    if (!pending?.attachments || !_sameAttachments(
      pending.attachments,
      input.attachments
    )) {
      throw new Error("Sandbox attachment staging transaction is unavailable.");
    }
    await this._clearPendingAttachment(input.sessionId, input.messageId);
  }

  async reconcileAttachmentStaging(
    sessionId: string,
    attachments: Readonly<Record<
      string,
      readonly SandboxAttachmentDescriptor[]
    >>
  ): Promise<void> {
    const record = this._registry.sessions[sessionId];
    const pending = record?.pendingAttachments;
    if (!record || !pending || Object.keys(pending).length === 0) { return; }
    const unresolved = Object.fromEntries(
      Object.entries(pending).filter(([messageId, transaction]) =>
        !transaction.attachments
        || !_sameAttachments(
          transaction.attachments,
          attachments[messageId] ?? []
        ))
    );
    if (Object.keys(unresolved).length !== Object.keys(pending).length) {
      this._registry = {
        ...this._registry,
        sessions: {
          ...this._registry.sessions,
          [sessionId]: {
            ...record,
            pendingAttachments: Object.keys(unresolved).length > 0
              ? unresolved
              : undefined
          }
        }
      };
      await this._saveRegistry();
    }
    if (Object.keys(unresolved).length > 0) {
      throw new Error("Sandbox attachment staging is incomplete.");
    }
  }

  async acquire(input: {
    readonly expectedExisting?: boolean;
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
  }): Promise<SandboxProviderSession> {
    const record = this._registry.sessions[input.sessionId];
    if (record?.state === "lost") { throw new SandboxWorkspaceLostError(); }
    if (record?.state === "cleanupPending") {
      throw new Error("Sandbox cleanup is pending");
    }
    const fresh = !record && input.expectedExisting !== true;
    if (!record) {
      this._registry = {
        ...this._registry,
        sessions: {
          ...this._registry.sessions,
          [input.sessionId]: {
            state: fresh ? "cleanupPending" : "active"
          }
        }
      };
      await this._saveRegistry();
    }
    try {
      const session = await this._provider.acquire({
        expectedExisting: input.expectedExisting === true
          || record?.state === "active",
        seed: input.seed,
        sessionId: input.sessionId
      });
      if (fresh) {
        this._registry = {
          ...this._registry,
          sessions: {
            ...this._registry.sessions,
            [input.sessionId]: { state: "active" }
          }
        };
        await this._saveRegistry();
      }
      return session;
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

  async stop(sessionId?: string): Promise<void> {
    if (sessionId !== undefined) {
      if (this._registry.sessions[sessionId]?.state === "active") {
        await this._provider.stop(sessionId);
      }
      return;
    }
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

  private _hasPendingAttachments(sessionId: string): boolean {
    return Object.keys(
      this._registry.sessions[sessionId]?.pendingAttachments ?? {}
    ).length > 0;
  }

  private async _setPendingAttachment(
    sessionId: string,
    messageId: string,
    transaction: SandboxAttachmentTransaction
  ): Promise<void> {
    const record = this._registry.sessions[sessionId];
    if (record?.state !== "active") {
      throw new Error("Sandbox Session is unavailable.");
    }
    this._registry = {
      ...this._registry,
      sessions: {
        ...this._registry.sessions,
        [sessionId]: {
          ...record,
          pendingAttachments: {
            ...record.pendingAttachments,
            [messageId]: transaction
          }
        }
      }
    };
    await this._saveRegistry();
  }

  private async _clearPendingAttachment(
    sessionId: string,
    messageId: string
  ): Promise<void> {
    const record = this._registry.sessions[sessionId];
    if (!record?.pendingAttachments?.[messageId]) { return; }
    const pendingAttachments = Object.fromEntries(
      Object.entries(record.pendingAttachments)
        .filter(([candidate]) => candidate !== messageId)
    );
    this._registry = {
      ...this._registry,
      sessions: {
        ...this._registry.sessions,
        [sessionId]: {
          ...record,
          pendingAttachments: Object.keys(pendingAttachments).length > 0
            ? pendingAttachments
            : undefined
        }
      }
    };
    await this._saveRegistry();
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
          ] => Boolean(entry[0] && _validRegistryRecord(entry[1])))
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

function _sameAttachments(
  left: readonly StagedSandboxAttachment[],
  right: readonly SandboxAttachmentDescriptor[]
): boolean {
  return left.length === right.length && left.every((attachment, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && sameSandboxAttachmentDescriptor(attachment, candidate);
  });
}

function _validRegistryRecord(value: unknown): value is SandboxRegistryRecord {
  if (!value || typeof value !== "object") { return false; }
  const record = value as Partial<SandboxRegistryRecord>;
  const validState = record.state === "active"
    || record.state === "cleanupPending"
    || record.state === "lost";
  if (!validState || record.pendingAttachments === undefined) {
    return validState;
  }
  return record.pendingAttachments !== null
    && typeof record.pendingAttachments === "object"
    && !Array.isArray(record.pendingAttachments)
    && Object.entries(record.pendingAttachments).every(([messageId, entry]) =>
      messageId.length > 0
      && entry !== null
      && typeof entry === "object"
      && typeof entry.stagingId === "string"
      && entry.stagingId.length > 0
      && typeof entry.turnId === "string"
      && entry.turnId.length > 0
      && (entry.attachments === undefined
        || (Array.isArray(entry.attachments)
          && entry.attachments.every(_validStagedAttachment))));
}

function _validStagedAttachment(
  value: unknown
): value is StagedSandboxAttachment {
  if (!value || typeof value !== "object") { return false; }
  const attachment = value as Partial<StagedSandboxAttachment>;
  return typeof attachment.id === "string"
    && typeof attachment.name === "string"
    && typeof attachment.path === "string"
    && typeof attachment.size === "number"
    && typeof attachment.fingerprint === "string"
    && (attachment.mimeType === undefined
      || typeof attachment.mimeType === "string");
}
