import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { KeyedOperationCoordinator } from "../../internal/keyed-operation-coordinator";
import type { SessionCommand } from "../../session/protocol";
import type {
  NewSessionCommand,
  SessionCommandEnqueueResult,
  SessionCommandLease,
  SessionCommandQueue,
  SessionCommandRecovery,
} from "../../session/session-command-queue";

import { encodeSessionStorageKey } from "./encode-session-storage-key";
import { getFileErrorCode } from "./get-file-error-code";
import { isStoredSessionCommand } from "./stored-session-command";

interface StoredCommandFile {
  readonly command: SessionCommand;
  readonly path: string;
}

export class FileSessionCommandQueue implements SessionCommandQueue {
  constructor(
    private readonly _root: string,
    private readonly _coordinator = new KeyedOperationCoordinator()
  ) {}

  enqueue(proposed: NewSessionCommand): Promise<SessionCommandEnqueueResult> {
    const sessionRoot = this._sessionRoot(proposed.sessionId);
    return this._coordinator.run(sessionRoot, async () => {
      await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
      while (true) {
        await this._repairReservedCommands(proposed.sessionId);
        const files = await this._readCommandFiles(proposed.sessionId);
        const existing = files.find(
          ({ command }) => command.id === proposed.id
        )?.command;
        if (existing !== undefined) {
          return {
            status: "duplicate",
            command: structuredClone(existing),
          };
        }
        const sequence =
          files.reduce(
            (latest, { command }) => Math.max(latest, command.sequence),
            0
          ) + 1;
        const command: SessionCommand = {
          ...structuredClone(proposed),
          sequence,
        };
        const reservation = this._commandPath(command, "reserved");
        const temporary = `${reservation}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(command, null, 2)}\n`, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          try {
            await link(temporary, reservation);
            await link(
              reservation,
              this._commandPath(command, "pending")
            ).catch((error: unknown) => {
              if (getFileErrorCode(error) !== "EEXIST") throw error;
            });
            return {
              status: "enqueued",
              command: structuredClone(command),
            };
          } catch (error) {
            if (getFileErrorCode(error) !== "EEXIST") throw error;
          }
        } finally {
          await rm(temporary, { force: true });
        }
      }
    });
  }

  claim(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandLease | undefined> {
    const sessionRoot = this._sessionRoot(sessionId);
    return this._coordinator.run(sessionRoot, async () => {
      while (true) {
        await this._repairReservedCommands(sessionId);
        const recovery = await this._recover(sessionId, options);
        if (recovery.active.length > 0) return undefined;
        const recovered = recovery.recovered[0];
        if (recovered !== undefined) return recovered;
        const pending = (await this._readCommandFiles(sessionId))
          .filter(({ path }) => path.endsWith(".pending.json"))
          .sort(
            (left, right) => left.command.sequence - right.command.sequence
          );
        const first = pending[0];
        if (first === undefined) return undefined;
        const leaseOwner = crypto.randomUUID().replaceAll("-", "");
        const claimedPath = first.path.replace(
          /\.pending\.json$/,
          `.${options.leaseExpiresAt}.${leaseOwner}.claimed.json`
        );
        try {
          await rename(first.path, claimedPath);
        } catch (error) {
          if (getFileErrorCode(error) === "ENOENT") continue;
          throw error;
        }
        return this._lease(sessionRoot, first.command, claimedPath);
      }
    });
  }

  recover(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandRecovery> {
    const sessionRoot = this._sessionRoot(sessionId);
    return this._coordinator.run(sessionRoot, () =>
      this._recover(sessionId, options)
    );
  }

  private async _recover(
    sessionId: string,
    options: { readonly now: number; readonly leaseExpiresAt: number }
  ): Promise<SessionCommandRecovery> {
    await this._repairReservedCommands(sessionId);
    const active: SessionCommandRecovery["active"][number][] = [];
    const recovered: SessionCommandLease[] = [];
    for (const file of await this._readCommandFiles(sessionId)) {
      const leaseExpiresAt = _claimedLeaseExpiration(file.path);
      if (leaseExpiresAt === undefined) continue;
      if (leaseExpiresAt > options.now) {
        active.push({
          command: structuredClone(file.command),
          leaseExpiresAt,
        });
        continue;
      }
      try {
        const leaseOwner = crypto.randomUUID().replaceAll("-", "");
        const recoveredPath = file.path.replace(
          /\.\d+\.[a-f0-9]+\.claimed\.json$/,
          `.${options.leaseExpiresAt}.${leaseOwner}.claimed.json`
        );
        await rename(file.path, recoveredPath);
        recovered.push(
          this._lease(this._sessionRoot(sessionId), file.command, recoveredPath)
        );
      } catch (error) {
        if (getFileErrorCode(error) !== "ENOENT") throw error;
      }
    }
    return { active, recovered };
  }

  private _lease(
    sessionRoot: string,
    command: SessionCommand,
    initialPath: string
  ): SessionCommandLease {
    let claimedPath = initialPath;
    let mutation = Promise.resolve();
    const runMutation = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = mutation.then(operation);
      mutation = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    };
    return {
      command: structuredClone(command),
      complete: () =>
        runMutation(() => this._complete(sessionRoot, claimedPath)),
      release: () => runMutation(() => this._release(sessionRoot, claimedPath)),
      renew: (leaseExpiresAt) =>
        runMutation(async () => {
          claimedPath = await this._renew(
            sessionRoot,
            claimedPath,
            leaseExpiresAt
          );
        }),
    };
  }

  private _complete(sessionRoot: string, claimedPath: string): Promise<void> {
    return this._coordinator.run(sessionRoot, async () => {
      try {
        await rename(claimedPath, _terminalPath(claimedPath));
      } catch (error) {
        if (getFileErrorCode(error) !== "ENOENT") throw error;
      }
    });
  }

  private _release(sessionRoot: string, claimedPath: string): Promise<void> {
    return this._coordinator.run(sessionRoot, async () => {
      try {
        await rename(claimedPath, _pendingPath(claimedPath));
      } catch (error) {
        if (getFileErrorCode(error) !== "ENOENT") throw error;
      }
    });
  }

  private _renew(
    sessionRoot: string,
    claimedPath: string,
    leaseExpiresAt: number
  ): Promise<string> {
    return this._coordinator.run(sessionRoot, async () => {
      const renewedPath = claimedPath.replace(
        /\.\d+\.([a-f0-9]+)\.claimed\.json$/,
        `.${leaseExpiresAt}.$1.claimed.json`
      );
      await rename(claimedPath, renewedPath);
      return renewedPath;
    });
  }

  private async _readCommandFiles(
    sessionId: string
  ): Promise<StoredCommandFile[]> {
    const sessionRoot = this._sessionRoot(sessionId);
    let names: string[];
    try {
      names = await readdir(sessionRoot);
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const path = join(sessionRoot, name);
          try {
            return {
              command: await _readStoredCommand(path, sessionId),
              path,
            };
          } catch (error) {
            if (getFileErrorCode(error) === "ENOENT") return undefined;
            throw error;
          }
        })
    );
    return files.filter((file) => file !== undefined);
  }

  private async _repairReservedCommands(sessionId: string): Promise<void> {
    const files = await this._readCommandFiles(sessionId);
    const reservations = files.filter(({ path }) =>
      path.endsWith(".reserved.json")
    );
    for (const reservation of reservations) {
      const hasState = files.some(
        (file) =>
          file.command.sequence === reservation.command.sequence &&
          !file.path.endsWith(".reserved.json")
      );
      if (hasState) continue;
      try {
        await link(
          reservation.path,
          this._commandPath(reservation.command, "pending")
        );
      } catch (error) {
        const code = getFileErrorCode(error);
        if (code !== "EEXIST" && code !== "ENOENT") throw error;
      }
    }
  }

  private _commandsRoot(): string {
    return join(this._root, "commands");
  }

  private _sessionRoot(sessionId: string): string {
    return join(this._commandsRoot(), encodeSessionStorageKey(sessionId));
  }

  private _commandPath(
    command: SessionCommand,
    state: "reserved" | "pending" | "completed"
  ): string {
    return join(
      this._sessionRoot(command.sessionId),
      `${command.sequence.toString().padStart(16, "0")}.${state}.json`
    );
  }
}

function _claimedLeaseExpiration(path: string): number | undefined {
  const match = /\.(\d+)\.[a-f0-9]+\.claimed\.json$/.exec(path);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function _pendingPath(path: string): string {
  return path.replace(/\.\d+\.[a-f0-9]+\.claimed\.json$/, ".pending.json");
}

function _terminalPath(path: string): string {
  return path.replace(
    /\.(?:pending|\d+\.[a-f0-9]+\.claimed)\.json$/,
    ".completed.json"
  );
}

async function _readStoredCommand(
  path: string,
  sessionId: string
): Promise<SessionCommand> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (getFileErrorCode(error) === "ENOENT") throw error;
    throw new Error(`Unable to read session command in "${path}".`, {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw new Error(`Invalid session command JSON in "${path}".`, { cause });
  }
  if (!isStoredSessionCommand(value, sessionId)) {
    throw new Error(`Invalid session command in "${path}".`);
  }
  return value;
}
