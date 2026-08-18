import { Updater } from "electrobun/bun";
import { inject, injectable, preDestroy } from "inversify";

import { EventHub } from "../../shared/event-hub";
import type {
  UpdateMode,
  UpdateStatus,
  UpdateStatusChangedPayload,
} from "../../shared/updates";
import type { UpdatesEvents } from "../../shared/updates-rpc";
import { setUpdateReadyInMenu } from "../app/menu";

import { UpdatesState } from "./updates-state";

const INITIAL_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
const APPLY_GRACE_MS = 5_000;

/** Process-scoped updater state and scheduling. */
@injectable()
export class UpdaterService {
  readonly events = new EventHub<UpdatesEvents>();
  private _isCheckInFlight = false;
  private _isPassManual = false;
  private _lastStatus: UpdateStatus | null = null;
  private _installedVersion: string | null = null;
  private _backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  private _backgroundInterval: ReturnType<typeof setInterval> | null = null;
  private _applyTimer: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;

  constructor(@inject(UpdatesState) private readonly _state: UpdatesState) {}

  async checkForUpdates(manual: boolean): Promise<void> {
    if (this._stopped) return;
    if (this._isCheckInFlight) {
      if (manual && !this._isPassManual) {
        this._isPassManual = true;
        if (this._lastStatus) this._sendStatus(this._lastStatus);
      }
      return;
    }
    this._isCheckInFlight = true;
    this._isPassManual = manual;
    try {
      this._sendStatus({ state: "checking" });
      const info = await Updater.checkForUpdate();
      if (this._stopped) return;
      if (info.error) {
        this._sendStatus({ state: "error", message: info.error });
        return;
      }
      if (!info.updateAvailable) {
        setUpdateReadyInMenu(null);
        const { version } = await Updater.getLocalInfo();
        if (this._stopped) return;
        this._sendStatus({ state: "up-to-date", version });
        return;
      }
      this._sendStatus({ state: "downloading", version: info.version });
      await Updater.downloadUpdate();
      if (this._stopped) return;
      if (!Updater.updateInfo()?.updateReady) {
        const message =
          Updater.updateInfo()?.error || "download did not complete";
        this._sendStatus({ state: "error", message });
        return;
      }
      setUpdateReadyInMenu(info.version);
      this._sendStatus({ state: "ready", version: info.version });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._sendStatus({ state: "error", message });
    } finally {
      this._isCheckInFlight = false;
    }
  }

  async applyUpdateAndRestart(): Promise<void> {
    if (this._stopped) return;
    try {
      await Updater.applyUpdate();
    } catch (error) {
      this._isPassManual = true;
      const message = error instanceof Error ? error.message : String(error);
      this._sendStatus({ state: "error", message });
      return;
    }
    if (this._stopped) return;
    if (this._applyTimer) clearTimeout(this._applyTimer);
    this._applyTimer = setTimeout(() => {
      this._applyTimer = null;
      void this.checkForUpdates(true);
    }, APPLY_GRACE_MS);
  }

  getInstalledVersion(): string | null {
    const version = this._installedVersion;
    this._installedVersion = null;
    return version;
  }

  async getUpdateModeSetting(): Promise<UpdateMode> {
    return this._state.getMode();
  }

  async setUpdateModeSetting(mode: UpdateMode): Promise<void> {
    await this._state.setMode(mode);
    this._applySchedule(mode);
  }

  async start(): Promise<void> {
    if (this._stopped) return;
    try {
      await this._start();
    } catch (error) {
      if (this._stopped) return;
      const message = error instanceof Error ? error.message : String(error);
      this._sendStatus({ state: "error", message });
    }
  }

  /** Initialize persisted update identity without outliving process shutdown. */
  private async _start(): Promise<void> {
    const { channel, hash, version, identifier } = await Updater.getLocalInfo();
    if (this._stopped) return;
    if (channel === "dev") return;

    const lastSeen = await this._state.getLastSeenHash(identifier);
    if (this._stopped) return;
    if (lastSeen && lastSeen !== hash) this._installedVersion = version;
    if (lastSeen !== hash) await this._state.setLastSeenHash(identifier, hash);
    if (this._stopped) return;

    this._applySchedule(await this._state.getMode());
  }

  /** Stop update scheduling; the process Container separately drains state. */
  @preDestroy()
  stop(): void {
    if (this._stopped) return;
    this._stopped = true;
    this._clearSchedule();
    this.events.dispose();
  }

  private _sendStatus(status: UpdateStatus): void {
    if (this._stopped) return;
    this._lastStatus = status;
    const payload: UpdateStatusChangedPayload = {
      status,
      manual: this._isPassManual,
    };
    this.events.publish("statusChanged", payload);
  }

  private _clearSchedule(): void {
    if (this._backgroundTimer) clearTimeout(this._backgroundTimer);
    if (this._backgroundInterval) clearInterval(this._backgroundInterval);
    if (this._applyTimer) clearTimeout(this._applyTimer);
    this._backgroundTimer = null;
    this._backgroundInterval = null;
    this._applyTimer = null;
  }

  private _applySchedule(mode: UpdateMode): void {
    this._clearSchedule();
    if (this._stopped || mode !== "automatic") return;
    this._backgroundTimer = setTimeout(
      () => void this.checkForUpdates(false),
      INITIAL_CHECK_DELAY_MS
    );
    this._backgroundInterval = setInterval(
      () => void this.checkForUpdates(false),
      CHECK_INTERVAL_MS
    );
  }
}
