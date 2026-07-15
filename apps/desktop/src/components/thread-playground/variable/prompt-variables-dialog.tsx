"use client";

import { memo } from "react";

import {
  type PromptVariableSelection,
  PromptVariablesPanel
} from "./prompt-variables-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../ui/dialog";

interface PromptVariablesDialogProps {
  readonly open: boolean;
  readonly disabled?: boolean;
  readonly initialSelection?: PromptVariableSelection | null;
  readonly onOpenChange: (open: boolean) => void;
}

function _PromptVariablesDialog({
  open,
  disabled,
  initialSelection,
  onOpenChange
}: PromptVariablesDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[620px] max-h-[calc(100vh-4rem)] w-[min(920px,calc(100vw-2rem))] max-w-none! flex-col gap-0 overflow-hidden p-0"
        onInteractOutside={e => { e.preventDefault(); }}
        onPointerDownOutside={e => { e.preventDefault(); }}
      >
        <DialogHeader className="border-border/70 shrink-0 border-b px-4 py-3 pr-10">
          <DialogTitle>Variables</DialogTitle>
          <DialogDescription>
            Use `{"{{variable_name}}"}` as placeholder in your prompt, messages
            and tool results to reference the variable. e.g. `
            {"{{current_date}}"}` will be replaced with the current date.
          </DialogDescription>
        </DialogHeader>
        <PromptVariablesPanel
          className="min-h-0 grow"
          disabled={disabled}
          initialSelection={initialSelection}
        />
      </DialogContent>
    </Dialog>
  );
}

export const PromptVariablesDialog = memo(_PromptVariablesDialog);
