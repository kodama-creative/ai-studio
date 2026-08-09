import type { SessionCommand } from "../session/protocol";
import type {
  NewSessionCommand,
  SessionCommandEnqueueResult,
  SessionCommandLease,
  SessionCommandQueue,
  SessionCommandRecovery,
} from "../session/session-command-queue";

interface CommandEntry {
  readonly command: SessionCommand;
  state: "pending" | "claimed";
  leaseExpiresAt?: number;
  leaseOwner?: string;
}

export class InMemorySessionCommandQueue implements SessionCommandQueue {
  private readonly _entries = new Map<string, CommandEntry[]>();
  private readonly _completed = new Map<string, SessionCommand>();
  private readonly _nextSequence = new Map<string, number>();

  enqueue(command: NewSessionCommand): Promise<SessionCommandEnqueueResult> {
    const existing =
      this._entries
        .get(command.sessionId)
        ?.find((entry) => entry.command.id === command.id)?.command ??
      this._completed.get(command.id);
    if (existing !== undefined) {
      return Promise.resolve({
        status: "duplicate",
        command: structuredClone(existing),
      });
    }
    const sequence = this._nextSequence.get(command.sessionId) ?? 1;
    const accepted: SessionCommand = { ...structuredClone(command), sequence };
    this._nextSequence.set(command.sessionId, sequence + 1);
    const entries = this._entries.get(command.sessionId) ?? [];
    entries.push({ command: accepted, state: "pending" });
    this._entries.set(command.sessionId, entries);
    return Promise.resolve({
      status: "enqueued",
      command: structuredClone(accepted),
    });
  }

  claim(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandLease | undefined> {
    const entries = this._entries.get(sessionId) ?? [];
    for (const candidate of entries) {
      if (
        candidate.state === "claimed" &&
        (candidate.leaseExpiresAt ?? 0) <= options.now
      ) {
        candidate.state = "pending";
        candidate.leaseExpiresAt = undefined;
        candidate.leaseOwner = undefined;
      }
    }
    if (entries.some((candidate) => candidate.state === "claimed")) {
      return Promise.resolve(undefined);
    }
    const entry = entries
      .filter((candidate) => candidate.state === "pending")
      .sort((left, right) => left.command.sequence - right.command.sequence)[0];
    if (entry === undefined) return Promise.resolve(undefined);
    entry.state = "claimed";
    entry.leaseExpiresAt = options.leaseExpiresAt;
    const leaseOwner = crypto.randomUUID();
    entry.leaseOwner = leaseOwner;
    return Promise.resolve(this._lease(sessionId, entry, leaseOwner));
  }

  recover(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandRecovery> {
    const active: SessionCommandRecovery["active"][number][] = [];
    const recovered: SessionCommandLease[] = [];
    for (const entry of this._entries.get(sessionId) ?? []) {
      if (entry.state !== "claimed") continue;
      if ((entry.leaseExpiresAt ?? 0) > options.now) {
        active.push({
          command: structuredClone(entry.command),
          leaseExpiresAt: entry.leaseExpiresAt ?? options.now,
        });
        continue;
      }
      const leaseOwner = crypto.randomUUID();
      entry.leaseExpiresAt = options.leaseExpiresAt;
      entry.leaseOwner = leaseOwner;
      recovered.push(this._lease(sessionId, entry, leaseOwner));
    }
    return Promise.resolve({ active, recovered });
  }

  private _lease(
    sessionId: string,
    entry: CommandEntry,
    leaseOwner: string
  ): SessionCommandLease {
    return {
      command: structuredClone(entry.command),
      complete: () => this._complete(sessionId, entry.command.id, leaseOwner),
      release: () => this._release(sessionId, entry.command.id, leaseOwner),
      renew: (leaseExpiresAt) =>
        this._renew(sessionId, entry.command.id, leaseOwner, leaseExpiresAt),
    };
  }

  private _complete(
    sessionId: string,
    commandId: string,
    leaseOwner: string
  ): Promise<void> {
    const entries = this._entries.get(sessionId) ?? [];
    const index = entries.findIndex(
      (entry) =>
        entry.command.id === commandId &&
        entry.state === "claimed" &&
        entry.leaseOwner === leaseOwner
    );
    if (index === -1) return Promise.resolve();
    const [completed] = entries.splice(index, 1);
    if (completed !== undefined) {
      this._completed.set(commandId, structuredClone(completed.command));
    }
    if (entries.length === 0) this._entries.delete(sessionId);
    return Promise.resolve();
  }

  private _release(
    sessionId: string,
    commandId: string,
    leaseOwner: string
  ): Promise<void> {
    const entry = this._entries
      .get(sessionId)
      ?.find((candidate) => candidate.command.id === commandId);
    if (entry?.state === "claimed" && entry.leaseOwner === leaseOwner) {
      entry.state = "pending";
      entry.leaseExpiresAt = undefined;
      entry.leaseOwner = undefined;
    }
    return Promise.resolve();
  }

  private _renew(
    sessionId: string,
    commandId: string,
    leaseOwner: string,
    leaseExpiresAt: number
  ): Promise<void> {
    const entry = this._entries
      .get(sessionId)
      ?.find((candidate) => candidate.command.id === commandId);
    if (entry?.state !== "claimed" || entry.leaseOwner !== leaseOwner) {
      return Promise.reject(
        new Error(`Session command lease "${commandId}" is no longer active.`)
      );
    }
    entry.leaseExpiresAt = leaseExpiresAt;
    return Promise.resolve();
  }
}
