import type { RuntimeId } from "@/shared/runtime";

import type {
  PanePersistenceChange,
  PaneRunSettled,
  PaneRunStart,
} from "./runtime-run-tracker";

export interface PaneLifecycleHost {
  isMutationReserved: (
    paneId: string,
    runtimeId: RuntimeId,
    path?: string
  ) => boolean;
  onPersistenceChange: PanePersistenceChange;
  onRefreshSettled: (paneId: string) => void;
  onRunSettled: PaneRunSettled;
  onRunStart: PaneRunStart;
}
