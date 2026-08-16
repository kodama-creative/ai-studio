"use client";

import { Button } from "@llm-space/ui/ui/button";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect } from "react";
import { toast } from "sonner";

import { RENDERER_EVENTS } from "@/app/di/common-module";
import { UPDATE_STATUS_CONTROLLER } from "@/app/di/main-window-module";
import { useController, useInject } from "@/app/di/react";
import type { RendererEventEmitter } from "@/app/events/renderer-events";
import { UpdateDialog } from "@/components/update-dialog";

// The dialog only covers the quick / terminal states (checking → up-to-date /
// error). The long, non-interactive states live bottom-right as passive cards so
// they never block the app: a persistent "downloading" progress card that the
// "ready" card then replaces, plus the always-on badge.
const READY_TOAST_ID = "app-update-ready";
const DOWNLOADING_TOAST_ID = "app-update-downloading";
const READY_TOAST_DURATION_MS = 8000;
const UPDATE_TOAST_POSITION = "bottom-right" as const;

interface UpdateStatusValue {
  /** Version downloaded and ready to install, or null. Drives the badge. */
  readyVersion: string | null;
}

/**
 * The passive "update ready" card for background downloads — a dark glass card
 * with an emerald check badge and a trailing Restart action. Rendered via
 * `toast.custom` so it owns the whole card look rather than sonner's default
 * toast chrome. Manual checks use {@link UpdateDialog} instead.
 */
function _UpdateReadyCard({
  version,
  onRestart,
  onDismiss,
}: {
  version: string;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex w-[356px] max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-white/15 bg-black/45 p-3.5 text-white shadow-2xl backdrop-blur-md">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/18 text-emerald-200">
        <CheckIcon className="size-4" />
      </div>
      <div className="min-w-0 grow">
        <div className="text-sm font-medium">Update ready</div>
        <div className="truncate text-xs text-white/65">
          v{version} is ready to install.
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onRestart}>
          Restart
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex size-6 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * The passive "downloading" progress card for the bottom-right corner. A
 * download can take a while and needs no interaction, so it stays out of the way
 * (never a modal) with an indeterminate bar until the "ready" card replaces it.
 */
function _UpdateDownloadingCard({
  version,
  onDismiss,
}: {
  version: string;
  onDismiss: () => void;
}) {
  return (
    <div className="w-[356px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-black/45 p-3.5 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80">
          <Loader2Icon className="size-4 animate-spin" />
        </div>
        <div className="min-w-0 grow">
          <div className="text-sm font-medium">Downloading update</div>
          <div className="truncate text-xs text-white/65">
            v{version} — this continues in the background.
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full w-2/5 rounded-full bg-white/70"
          style={{ animation: "update-progress 1.2s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}

/** React projection for update dialogs and event-driven passive cards. */
export function UpdateStatusSurface() {
  const { controller, state } = useController(UPDATE_STATUS_CONTROLLER);
  const events = useInject<RendererEventEmitter>(RENDERER_EVENTS);
  useLayoutEffect(() => {
    const downloading = (version: string) => {
      toast.custom(
        (id) => (
          <_UpdateDownloadingCard
            version={version}
            onDismiss={() => toast.dismiss(id)}
          />
        ),
        {
          id: DOWNLOADING_TOAST_ID,
          position: UPDATE_TOAST_POSITION,
          duration: Infinity,
        }
      );
    };
    const ready = (version: string) => {
      toast.dismiss(DOWNLOADING_TOAST_ID);
      toast.custom(
        (id) => (
          <_UpdateReadyCard
            version={version}
            onRestart={controller.restart}
            onDismiss={() => toast.dismiss(id)}
          />
        ),
        {
          id: READY_TOAST_ID,
          position: UPDATE_TOAST_POSITION,
          duration: READY_TOAST_DURATION_MS,
        }
      );
    };
    const installed = (version: string) => {
      toast.success(`Updated to v${version}`, {
        action: {
          label: "Release notes",
          onClick: () => controller.openReleaseNotes(version),
        },
      });
    };
    events.on("updates:downloading", downloading);
    events.on("updates:ready", ready);
    events.on("updates:installed", installed);
    return () => {
      events.off("updates:downloading", downloading);
      events.off("updates:ready", ready);
      events.off("updates:installed", installed);
    };
  }, [controller, events]);

  useEffect(() => {
    if (
      state.manualStatus?.state === "up-to-date" ||
      state.manualStatus?.state === "error"
    ) {
      toast.dismiss(DOWNLOADING_TOAST_ID);
    }
  }, [state.manualStatus]);
  return (
    <UpdateDialog
      open={state.dialogOpen}
      status={state.manualStatus}
      onOpenChange={controller.setDialogOpen}
      onRestart={controller.restart}
      onRetry={controller.recheck}
    />
  );
}

export function useUpdateStatus(): UpdateStatusValue {
  const readyVersion = useController(
    UPDATE_STATUS_CONTROLLER,
    (snapshot) => snapshot.readyVersion
  ).state;
  return { readyVersion };
}
