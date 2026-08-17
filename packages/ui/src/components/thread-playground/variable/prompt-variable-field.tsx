"use client";

import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

/** Labels and lays out one field in a prompt-variable editor. */
export function PromptVariableField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}
