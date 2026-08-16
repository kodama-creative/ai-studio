import type { RendererEventEmitter } from "@/app/events/renderer-events";
import type { RendererCommandRegistry } from "@/commands/renderer-command-registry";
import type { UpdateStatusChangedPayload } from "@/shared/updates";
import type { UpdateStatus } from "@/shared/updates";

import { UpdateStatusConnection } from "./update-status-connection";

export interface UpdateStatusSnapshot {
  readonly readyVersion: string | null;
  readonly manualStatus: UpdateStatus | null;
  readonly dialogOpen: boolean;
}

interface UpdatesClient {
  on(
    event: "statusChanged",
    listener: (payload: UpdateStatusChangedPayload) => void
  ): { dispose(): void | Promise<void> };
  takeInstalledVersion(): Promise<string | null>;
}

/** Owns update status precedence and the manual-check workflow. */
export class UpdateStatusController {
  private readonly _listeners = new Set<() => void>();
  private readonly _connection: UpdateStatusConnection;
  private _dismissed = false;
  private _lastNotifiedVersion: string | null = null;
  private _snapshot: UpdateStatusSnapshot = {
    readyVersion: null,
    manualStatus: null,
    dialogOpen: false,
  };

  constructor(
    client: UpdatesClient,
    private readonly _commands: RendererCommandRegistry,
    private readonly _events: RendererEventEmitter
  ) {
    this._connection = new UpdateStatusConnection({
      subscribeStatus: (listener) => client.on("statusChanged", listener),
      takeInstalledVersion: () => client.takeInstalledVersion(),
      onStatus: this._handleStatus,
      onInstalledVersion: (version) =>
        this._events.emit("updates:installed", version),
    });
  }

  readonly getSnapshot = (): UpdateStatusSnapshot => this._snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    this._connection.start();
  }

  stop(): void {
    this._connection.stop();
  }

  readonly setDialogOpen = (open: boolean): void => {
    if (!open) this._dismissed = true;
    this._setSnapshot({ ...this._snapshot, dialogOpen: open });
  };

  readonly restart = (): void => {
    this._commands.executeCommand({
      type: "updates.applyAndRestart",
      args: {},
    });
  };

  readonly recheck = (): void => {
    this._commands.executeCommand({ type: "updates.check", args: {} });
  };

  readonly openReleaseNotes = (version: string): void => {
    this._commands.executeCommand({
      type: "shell.openLink",
      args: {
        url: `https://github.com/deer-flow/llm-space/releases/tag/v${version}`,
      },
    });
  };

  private readonly _handleStatus = ({
    status,
    manual,
  }: UpdateStatusChangedPayload): void => {
    let snapshot = this._snapshot;
    if (status.state === "ready") {
      snapshot = { ...snapshot, readyVersion: status.version };
    } else if (status.state === "up-to-date") {
      this._lastNotifiedVersion = null;
      snapshot = { ...snapshot, readyVersion: null };
    }

    switch (status.state) {
      case "checking":
      case "up-to-date":
      case "error": {
        if (status.state === "checking") this._dismissed = false;
        if (manual && !this._dismissed) {
          snapshot = {
            ...snapshot,
            manualStatus: status,
            dialogOpen: true,
          };
        }
        this._setSnapshot(snapshot);
        return;
      }
      case "downloading": {
        this._setSnapshot({ ...snapshot, dialogOpen: false });
        if (manual) this._events.emit("updates:downloading", status.version);
        return;
      }
      case "ready": {
        this._setSnapshot({ ...snapshot, dialogOpen: false });
        const alreadyAnnounced = this._lastNotifiedVersion === status.version;
        if (!manual && alreadyAnnounced) return;
        this._lastNotifiedVersion = status.version;
        this._events.emit("updates:ready", status.version);
        return;
      }
    }
  };

  private _setSnapshot(snapshot: UpdateStatusSnapshot): void {
    if (Object.is(this._snapshot, snapshot)) return;
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
