import { create } from "zustand";

import { useCommands } from "@/commands";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FirecrawlLimitDialogState {
  open: boolean;
  openDialog: () => void;
  setOpen: (open: boolean) => void;
}

/**
 * App-wide singleton controlling the Firecrawl daily-limit dialog. Unlike the
 * per-tab thread store, this is a single global instance because the limit error
 * can fire from multiple call sites (single tool call, "Call all" batch).
 */
const useFirecrawlLimitDialogStore = create<FirecrawlLimitDialogState>(set => ({
  open: false,
  openDialog: () => { set({ open: true }); },
  setOpen: open => { set({ open }); }
}));

/** Open the dialog from non-React call sites (tool-call catch blocks). */
export function openFirecrawlLimitDialog() {
  useFirecrawlLimitDialogStore.getState().openDialog();
}

/**
 * Mounted once inside `CommandProvider` (see `app/page.tsx`) so its confirm
 * action can dispatch the `openSettings` command.
 */
export function FirecrawlLimitDialog() {
  const open = useFirecrawlLimitDialogStore(state => state.open);
  const setOpen = useFirecrawlLimitDialogStore(state => state.setOpen);
  const { executeCommand } = useCommands();
  return (
    <ConfirmDialog
      cancelLabel="Not now"
      confirmLabel="Configure API key"
      confirmVariant="default"
      description="The built-in web tools hit Firecrawl's daily limit of free, unauthenticated credits. Add a Firecrawl API key to raise the limit and keep using web fetch and search."
      onConfirm={() => {
        executeCommand({ type: "openSettings", args: { tab: "search" } });
        setOpen(false);
      }}
      onOpenChange={setOpen}
      open={open}
      title="Firecrawl daily limit reached"
    />
  );
}
