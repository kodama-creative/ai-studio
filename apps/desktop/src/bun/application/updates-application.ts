import { ContainerModule, type ResolutionContext } from "inversify";

import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type {
  UpdateMode,
  UpdateStatusChangedPayload,
} from "../../shared/updates";
import type {
  UpdatesEvents,
  UpdatesRequests,
} from "../../shared/updates-rpc";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import type { UpdaterService } from "../updates";

export const UPDATES_APPLICATION =
  desktopToken<UpdatesApplication>("updates", "application");

/** Update preferences, commands, and process-local status events. */
export class UpdatesApplication implements UpdatesRequests, Disposable {
  readonly events = new EventHub<UpdatesEvents>();

  constructor(private readonly _updater: UpdaterService) {}

  getMode() {
    return this._updater.getUpdateModeSetting();
  }

  setMode(mode: UpdateMode) {
    return this._updater.setUpdateModeSetting(mode);
  }

  takeInstalledVersion() {
    return Promise.resolve(this._updater.getInstalledVersion());
  }

  check() {
    return this._updater.checkForUpdates(true);
  }

  applyAndRestart() {
    return this._updater.applyUpdateAndRestart();
  }

  notifyStatus(payload: UpdateStatusChangedPayload): void {
    this.events.publish("statusChanged", payload);
  }

  dispose(): void {
    this.events.dispose();
  }
}

/** Bind process-scoped update use cases. */
export function updatesApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<UpdatesApplication>(UPDATES_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new UpdatesApplication(context.get(PROCESS_TOKENS.updater))
      )
      .inSingletonScope();
  });
}
