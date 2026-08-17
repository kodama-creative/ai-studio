"use client";

import { cn } from "../../../lib/utils";

/** Renders a bounded, read-only preview of a resolved variable value. */
export function PromptVariablePreview({
  value,
  muted,
  className,
}: {
  value: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "bg-muted/30 text-foreground/80 max-h-28 overflow-auto rounded-md border px-2 py-1.5 font-mono text-xs whitespace-pre-wrap",
        muted && "text-muted-foreground",
        className
      )}
    >
      {value}
    </pre>
  );
}
