"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel = "Cancel",
  confirmLabel,
  confirmVariant = "destructive",
  onConfirm,
  dimBackground = true
}: {
  readonly cancelLabel?: string;
  readonly confirmLabel: string;
  readonly confirmVariant?: "default" | "destructive";
  readonly description?: ReactNode;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title: ReactNode;

  /**
   * Render the dimming/blur overlay behind the dialog. Set to `false` when the
   * dialog opens on top of another dialog (e.g. inside Settings) so the
   * backdrop isn't darkened a second time. Radix still blocks interaction and
   * closes on outside click without an overlay.
   */
  readonly dimBackground?: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent showOverlay={dimBackground}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description
            ? (
              <DialogDescription>{description}</DialogDescription>
            )
            : null}
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => { onOpenChange(false); }} variant="ghost">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} variant={confirmVariant}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
