"use client";

import { useMemo } from "react";

import { useController } from "@/app/di/react";

import {
  RemindersController,
  type RemindersSnapshot,
} from "./reminders-controller";

interface RemindersValue extends RemindersSnapshot {
  readonly requestFeature: () => Promise<void>;
  readonly requestGithubStar: () => Promise<void>;
  readonly markFeatureSeen: () => Promise<void>;
  readonly dismissGithubStarForever: () => Promise<void>;
}

/** Domain adapter over the window-scoped reminders controller. */
export function useReminders(): RemindersValue {
  const { controller, state } = useController(RemindersController);
  return useMemo(
    () => ({
      ...state,
      requestFeature: () => controller.requestFeature(),
      requestGithubStar: () => controller.requestGithubStar(),
      markFeatureSeen: () => controller.markFeatureSeen(),
      dismissGithubStarForever: () => controller.dismissGithubStarForever(),
    }),
    [controller, state]
  );
}
