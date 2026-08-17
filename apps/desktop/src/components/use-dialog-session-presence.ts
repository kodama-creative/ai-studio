import { useLayoutEffect, useState } from "react";

const DIALOG_CLOSE_ANIMATION_MS = 100;

/** Keep a DI-backed dialog mounted only until its close animation completes. */
export function useDialogSessionPresence(open: boolean): boolean {
  const [present, setPresent] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timeout = window.setTimeout(
      () => setPresent(false),
      DIALOG_CLOSE_ANIMATION_MS
    );
    return () => window.clearTimeout(timeout);
  }, [open]);

  return present;
}
