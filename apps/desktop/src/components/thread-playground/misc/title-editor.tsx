import { PencilIcon } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import {
  type FileStemValidationResult,
  validateThreadFileStem
} from "@/lib/thread-file";
import { cn } from "@/lib/utils";
import { Tooltip } from "../../tooltip";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

export type TitleValidator = (value: string) => FileStemValidationResult;

const _TitleEditor = function TitleEditor({
  className,
  title,
  readonly,
  onRename,
  validateTitle = validateThreadFileStem
}: {
  readonly className?: string;
  readonly onRename?: (title: string) => Promise<boolean>;
  readonly readonly?: boolean;
  readonly title: string;
  readonly validateTitle?: TitleValidator;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const validation = useMemo(
    () => validateTitle(draftTitle),
    [draftTitle, validateTitle]
  );

  const startEditing = useCallback(() => {
    setDraftTitle(title);
    setError(null);
    setEditing(true);
  }, [title]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const commitEditing = useCallback(async () => {
    const result = validateTitle(draftTitle);
    if (!result.valid) {
      setError(result.error ?? "Invalid file name.");
      focusInput();
      return;
    }
    if (result.value === title || !onRename) {
      setEditing(false);
      return;
    }
    setCommitting(true);
    try {
      const renamed = await onRename(result.value);
      if (renamed) {
        setEditing(false);
      } else {
        focusInput();
      }
    } catch (err) {
      setError((err as Error).message);
      focusInput();
    } finally {
      setCommitting(false);
    }
  }, [draftTitle, focusInput, onRename, title, validateTitle]);

  const cancelEditing = useCallback(() => {
    cancelledRef.current = true;
    setEditing(false);
  }, []);

  const handleBlur = useCallback(() => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    void commitEditing();
  }, [commitEditing]);

  if (readonly) {
    return (
      <div className={cn("truncate text-sm font-medium", className)}>
        {title}
      </div>
    );
  }

  if (editing) {
    return (
      <div className={cn("relative", className)}>
        <Input
          aria-describedby="thread-title-error"
          aria-invalid={!validation.valid || !!error}
          aria-label="Thread title"
          autoFocus
          className="h-8 border-transparent bg-transparent! text-sm font-medium shadow-none focus-visible:ring-0"
          onBlur={handleBlur}
          onChange={event => {
            setDraftTitle(event.target.value);
            setError(null);
          }}
          onFocus={event => {
            event.currentTarget.select();
          }}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitEditing();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            }
          }}
          placeholder="untitled"
          readOnly={committing}
          ref={inputRef}
          value={draftTitle}
        />
        {(!validation.valid || error)
          ? (
            <div
              className="text-destructive absolute top-full left-2 z-10 mt-1 text-xs"
              id="thread-title-error"
            >
              {error ?? validation.error}
            </div>
          )
          : null}
      </div>
    );
  }

  return (
    <div className={cn("group flex w-full items-center gap-1", className)}>
      <div
        aria-label="Edit thread title"
        className="min-w-0 truncate text-sm font-medium"
        onClick={startEditing}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            startEditing();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <Tooltip content="Click to edit title">
          {title
            ? (
              <span>{title}</span>
            )
            : (
              <span className="text-muted-foreground">untitled</span>
            )}
        </Tooltip>
      </div>
      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip content="Edit title">
          <Button
            aria-label="Edit thread title"
            onClick={startEditing}
            size="icon-xs"
            variant="ghost"
          >
            <PencilIcon className="size-3" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export const TitleEditor = memo(_TitleEditor);
