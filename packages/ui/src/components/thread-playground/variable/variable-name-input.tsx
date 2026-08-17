"use client";

import { useEffect, useState } from "react";

import { cn } from "../../../lib/utils";
import { Input } from "../../../ui/input";

import { isVariableNameValid } from "./prompt-variable-utils";

/** Owns draft validation and commit/revert behavior for one variable name. */
export function VariableNameInput({
  name,
  disabled,
  className,
  ariaLabel,
  showFeedback = true,
  isAvailable,
  onCommit,
}: {
  name: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  showFeedback?: boolean;
  isAvailable: (name: string) => boolean;
  onCommit: (name: string) => boolean;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    setDraft(name);
  }, [name]);
  const trimmedDraft = draft.trim();
  const valid = isVariableNameValid(trimmedDraft);
  const available = trimmedDraft === name || isAvailable(trimmedDraft);
  const commit = () => {
    const next = trimmedDraft;
    if (next === name) {
      setDraft(name);
      return;
    }
    if (!valid || !available || !onCommit(next)) {
      setDraft(name);
      return;
    }
    setDraft(next);
  };
  return (
    <div className={cn("grid gap-1", className)}>
      <Input
        className={cn(
          "h-7 font-mono text-xs",
          !showFeedback && "h-7",
          (!valid || !available) && "border-destructive"
        )}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={!valid || !available}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(name);
            event.currentTarget.blur();
          }
        }}
      />
      {showFeedback && !valid ? (
        <div className="text-destructive text-xs">
          Use letters, numbers, and underscores; start with a letter or
          underscore.
        </div>
      ) : showFeedback && !available ? (
        <div className="text-destructive text-xs">Name already exists.</div>
      ) : null}
    </div>
  );
}
