"use client";

import {
  CheckIcon,
  DownloadIcon,
  Loader2Icon,
  type LucideIcon,
  TriangleAlertIcon
} from "lucide-react";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";

import type { UpdateStatus } from "@/shared/updates";

type Tone = "danger" | "primary" | "success";

interface UpdateDialogProps {
  readonly open: boolean;
  readonly status: UpdateStatus | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRestart: () => void;
  readonly onRetry: () => void;
}

/**
 * The manual "Check for Updates" flow, rendered as a single dialog that morphs
 * across the updater states (checking → up-to-date / downloading → ready, or
 * error) instead of a stack of toasts. Background checks stay silent — only the
 * badge + a passive card surface those.
 */
export function UpdateDialog({
  open,
  status,
  onOpenChange,
  onRestart,
  onRetry
}: UpdateDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 p-0 sm:max-w-[400px]">
        {status
          ? (
            <UpdateDialogBody
              onClose={() => { onOpenChange(false); }}
              onRestart={onRestart}
              onRetry={onRetry}
              status={status}
            />
          )
          : null}
      </DialogContent>
    </Dialog>
  );
}

interface View {
  tone: Tone;
  icon: LucideIcon;
  spin?: boolean;
  progress?: boolean;
  title: string;
  description: string;
  actions: ReactNode | null;
}

function UpdateDialogBody({
  status,
  onRestart,
  onRetry,
  onClose
}: {
  readonly onClose: () => void;
  readonly onRestart: () => void;
  readonly onRetry: () => void;
  readonly status: UpdateStatus;
}) {
  const view = viewFor(status, { onRestart, onRetry, onClose });
  return (
    <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
      <IconBadge icon={view.icon} spin={view.spin} tone={view.tone} />
      <DialogHeader className="mt-4 items-center gap-1.5">
        <DialogTitle className="text-base">{view.title}</DialogTitle>
        <DialogDescription className="text-sm text-balance">
          {view.description}
        </DialogDescription>
      </DialogHeader>
      {view.progress ? <IndeterminateBar tone={view.tone} /> : null}
      {view.actions
        ? (
          <DialogFooter className="mt-6 w-full sm:justify-center">
            {view.actions}
          </DialogFooter>
        )
        : null}
    </div>
  );
}

function viewFor(
  status: UpdateStatus,
  {
    onRestart,
    onRetry,
    onClose
  }: { onClose: () => void; onRestart: () => void; onRetry: () => void; }
): View {
  switch (status.state) {
    case "checking":
      return {
        tone: "primary",
        icon: Loader2Icon,
        spin: true,
        progress: true,
        title: "Checking for updates",
        description: "Contacting the update server…",
        actions: null
      };
    case "downloading":
      return {
        tone: "primary",
        icon: Loader2Icon,
        spin: true,
        progress: true,
        title: "Downloading update",
        description: `Getting version ${status.version} ready to install…`,
        actions: (
          <Button onClick={onClose} size="sm" variant="outline">
            Continue in background
          </Button>
        )
      };
    case "up-to-date":
      return {
        tone: "success",
        icon: CheckIcon,
        title: "You're all set!",
        description: `You're already running the latest version — v${status.version}.`,
        actions: (
          <Button onClick={onClose} size="sm">
            Gotcha
          </Button>
        )
      };
    case "ready":
      return {
        tone: "primary",
        icon: DownloadIcon,
        title: "Update ready",
        description: `Version ${status.version} has been downloaded and is ready to install. Restarting takes just a moment.`,
        actions: (
          <>
            <Button onClick={onClose} size="sm" variant="outline">
              Later
            </Button>
            <Button onClick={onRestart} size="sm">
              Restart now
            </Button>
          </>
        )
      };
    case "error":
      return {
        tone: "danger",
        icon: TriangleAlertIcon,
        title: "Update check failed",
        description: status.message,
        actions: (
          <>
            <Button onClick={onClose} size="sm" variant="outline">
              Close
            </Button>
            <Button onClick={onRetry} size="sm">
              Try again
            </Button>
          </>
        )
      };
  }
}

const TONE: Record<Tone, { badge: string; bar: string; glow: string; }> = {
  primary: {
    badge: "bg-primary/12 text-primary ring-primary/25",
    glow: "bg-primary/30",
    bar: "bg-primary"
  },
  success: {
    badge: "bg-emerald-500/12 text-emerald-300 ring-emerald-400/25",
    glow: "bg-emerald-500/30",
    bar: "bg-emerald-400"
  },
  danger: {
    badge: "bg-destructive/12 text-destructive ring-destructive/25",
    glow: "bg-destructive/30",
    bar: "bg-destructive"
  }
};

function IconBadge({
  tone,
  icon: Icon,
  spin
}: {
  readonly icon: LucideIcon;
  readonly spin?: boolean;
  readonly tone: Tone;
}) {
  const t = TONE[tone];
  return (
    <div className="relative">
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10 rounded-full opacity-70 blur-xl",
          t.glow
        )}
      />
      <div
        className={cn(
          "flex size-14 items-center justify-center rounded-full ring-1",
          t.badge
        )}
      >
        <Icon className={cn("size-6", spin && "animate-spin")} />
      </div>
    </div>
  );
}

function IndeterminateBar({ tone }: { readonly tone: Tone; }) {
  const t = TONE[tone];
  return (
    <div
      className={cn(
        "relative mt-5 h-1 w-40 overflow-hidden rounded-full",
        tone === "danger" ? "bg-destructive/15" : "bg-primary/15"
      )}
    >
      <div
        className={cn("absolute inset-y-0 w-2/5 rounded-full", t.bar)}
        style={{ animation: "update-progress 1.2s ease-in-out infinite" }}
      />
    </div>
  );
}
