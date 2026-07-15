"use client";

import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import { useCommands } from "@/commands";
import { Button } from "@/components/ui/button";
import { UpdateDialog } from "@/components/update-dialog";
import { electrobun } from "@/lib/electrobun";

import type {
  UpdateStatus,
  UpdateStatusChangedPayload
} from "@/shared/updates";

/** GitHub versioned-release page, opened from the "Updated to …" toast. */
const RELEASE_TAG_URL = "https://github.com/deer-flow/llm-space/releases/tag";
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
const _UpdateReadyCard = function UpdateReadyCard({
  version,
  onRestart,
  onDismiss
}: {
  readonly onDismiss: () => void;
  readonly onRestart: () => void;
  readonly version: string;
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
        <Button onClick={onRestart} size="sm">
          Restart
        </Button>
        <button
          aria-label="Dismiss"
          className="flex size-6 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          onClick={onDismiss}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * The passive "downloading" progress card for the bottom-right corner. A
 * download can take a while and needs no interaction, so it stays out of the way
 * (never a modal) with an indeterminate bar until the "ready" card replaces it.
 */
const _UpdateDownloadingCard = function UpdateDownloadingCard({
  version,
  onDismiss
}: {
  readonly onDismiss: () => void;
  readonly version: string;
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
          aria-label="Dismiss"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          onClick={onDismiss}
          type="button"
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
};

const UpdateStatusContext = createContext<UpdateStatusValue | null>(null);

/**
 * Owns app-update UI state for the whole page. A single listener for the
 * bun-side `updateStatusChanged` messages drives three things: the manual-check
 * dialog, the passive background "ready" card, and the persistent `readyVersion`
 * (consumed by {@link UpdateIndicator}).
 *
 * - Manual checks (menu) open a dialog that morphs across every state.
 * - Background checks stay silent except the first "ready", which shows a
 *   passive card; the badge is the durable affordance and never lingers as a toast.
 * - "Continue in background" (closing the dialog mid-flow) routes later states of
 *   that same manual flow to the silent path instead of re-popping the dialog.
 */
export function UpdateStatusProvider({ children }: { readonly children: ReactNode; }) {
  const { executeCommand } = useCommands();
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const lastNotifiedVersion = useRef<string | null>(null);
  // Manual "Check for Updates" flow.
  const [manualStatus, setManualStatus] = useState<UpdateStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Set when the user closes the manual dialog mid-flow, so later states of that
  // same flow don't re-open it (respecting "Continue in background").
  const dismissedRef = useRef(false);

  const restart = useCallback(
    () => { executeCommand({ type: "applyUpdateAndRestart", args: {} }); },
    [executeCommand]
  );
  const recheck = useCallback(
    () => { executeCommand({ type: "checkForUpdates", args: {} }); },
    [executeCommand]
  );
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) { dismissedRef.current = true; }
  }, []);

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) { return; }

    const handle = ({ status, manual }: UpdateStatusChangedPayload) => {
      // Keep the persistent badge in sync no matter how the check started.
      if (status.state === "ready") {
        setReadyVersion(status.version);
      } else if (status.state === "up-to-date") {
        // No update available now — clear any stale "ready" badge/card.
        setReadyVersion(null);
        lastNotifiedVersion.current = null;
      }

      switch (status.state) {
        // Quick / terminal states → the dialog (manual checks only). A fresh
        // "checking" starts a new session; a dialog the user closed mid-flow
        // stays closed for the rest of that flow.
        case "checking":
        case "up-to-date":
        case "error": {
          if (status.state !== "checking") { toast.dismiss(DOWNLOADING_TOAST_ID); }
          if (status.state === "checking") { dismissedRef.current = false; }
          if (manual && !dismissedRef.current) {
            setManualStatus(status);
            setDialogOpen(true);
          }
          return;
        }
        // Long, non-interactive → hand off to the non-blocking corner and close
        // the check dialog. Background downloads stay fully silent.
        case "downloading": {
          setDialogOpen(false);
          if (manual) {
            toast.custom(
              id => (
                <_UpdateDownloadingCard
                  onDismiss={() => { toast.dismiss(id); }}
                  version={status.version}
                />
              ),
              {
                id: DOWNLOADING_TOAST_ID,
                position: UPDATE_TOAST_POSITION,
                duration: Infinity
              }
            );
          }
          return;
        }
        // Downloaded → replace the progress card with the actionable ready card
        // (plus the badge). Manual always re-announces; background only the first
        // time for a given version.
        case "ready": {
          toast.dismiss(DOWNLOADING_TOAST_ID);
          setDialogOpen(false);
          const alreadyAnnounced = lastNotifiedVersion.current === status.version;
          if (!manual && alreadyAnnounced) { return; }
          lastNotifiedVersion.current = status.version;
          toast.custom(
            id => (
              <_UpdateReadyCard
                onDismiss={() => { toast.dismiss(id); }}
                onRestart={restart}
                version={status.version}
              />
            ),
            {
              id: READY_TOAST_ID,
              position: UPDATE_TOAST_POSITION,
              duration: READY_TOAST_DURATION_MS
            }
          );
          return;
        }
      }
    };

    rpc.addMessageListener("updateStatusChanged", handle);
    return () => { rpc.removeMessageListener("updateStatusChanged", handle); };
  }, [restart]);

  // "We just updated" — pulled once on mount, race-free vs. the fire-and-forget
  // status messages (the bun signal is computed at startup, before we listen).
  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) { return; }
    let cancelled = false;
    void rpc.request.pendingInstalledVersion({}).then(version => {
      if (cancelled || !version) { return; }
      toast.success(`Updated to v${version}`, {
        action: {
          label: "Release notes",
          onClick: () => {
            executeCommand({
              type: "openLink",
              args: { url: `${RELEASE_TAG_URL}/v${version}` }
            });
          }
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [executeCommand]);

  const contextValue = useMemo(() => ({ readyVersion }), [readyVersion]);

  return (
    <UpdateStatusContext.Provider value={contextValue}>
      {children}
      <UpdateDialog
        onOpenChange={handleDialogOpenChange}
        onRestart={restart}
        onRetry={recheck}
        open={dialogOpen}
        status={manualStatus}
      />
    </UpdateStatusContext.Provider>
  );
}

export function useUpdateStatus(): UpdateStatusValue {
  const ctx = useContext(UpdateStatusContext);
  if (!ctx) {
    throw new Error("useUpdateStatus must be used within UpdateStatusProvider");
  }
  return ctx;
}
