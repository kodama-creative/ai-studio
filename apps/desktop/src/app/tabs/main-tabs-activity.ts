import { inject, injectable } from "inversify";

import { PaneActivityTracker } from "../playground/pane-activity-tracker";

import type { AppTab, MainTabsActivity } from "./main-tabs-controller";

/** Adapts pane execution ownership to the tab-restoration policy. */
@injectable()
export class MainTabsActivityService implements MainTabsActivity {
  constructor(
    @inject(PaneActivityTracker)
    private readonly _panes: PaneActivityTracker
  ) {}

  canPruneRestoredTab(tab: AppTab): boolean {
    return (
      !this._panes.isPaneBusy(tab.paneId) &&
      !this._panes.isMutationReserved(tab.paneId)
    );
  }

  subscribe(listener: () => void): () => void {
    return this._panes.subscribe(listener);
  }
}
