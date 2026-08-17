"use client";

import type {
  ThreadVariable,
  ThreadWorkingDirectoryVariable,
} from "@llm-space/core";
import { FolderOpenIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useHostServices } from "../../../host";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";

import { DetailShell } from "./detail-shell";
import { PromptVariableField } from "./prompt-variable-field";
import {
  isBuiltInNameAvailable,
  normalizeDirectoryPath,
} from "./prompt-variable-utils";
import { VariableNameInput } from "./variable-name-input";

/** Edits the working-directory variable and owns its cancellable host checks. */
export function WorkingDirectoryVariableDetail({
  name,
  variable,
  disabled,
  variables,
  customNames,
  onRename,
  onUpdate,
}: {
  name: string;
  variable: ThreadWorkingDirectoryVariable;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  onRename: (oldName: string, newName: string) => boolean;
  onUpdate: (name: string, variable: ThreadWorkingDirectoryVariable) => void;
}) {
  const { builtinTools, files } = useHostServices();
  const [directoryExists, setDirectoryExists] = useState<boolean | null>(null);
  const directoryCheckIdRef = useRef(0);

  const checkPath = useCallback(
    async (rawValue: string) => {
      const checkId = ++directoryCheckIdRef.current;
      const value = normalizeDirectoryPath(rawValue);
      if (!value) {
        setDirectoryExists(null);
        return;
      }

      setDirectoryExists(null);
      try {
        const exists = await files.directoryExists(value);
        if (directoryCheckIdRef.current === checkId) {
          setDirectoryExists(exists);
        }
      } catch {
        if (directoryCheckIdRef.current === checkId) {
          setDirectoryExists(null);
        }
      }
    },
    [files]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void checkPath(variable.value);
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [checkPath, variable.value]);

  const commitPath = useCallback(
    (rawValue: string) => {
      const value = normalizeDirectoryPath(rawValue);
      if (value !== variable.value) {
        onUpdate(name, { ...variable, value });
      } else {
        void checkPath(value);
      }
    },
    [checkPath, name, onUpdate, variable]
  );

  const handlePathChange = useCallback(
    (value: string) => {
      ++directoryCheckIdRef.current;
      setDirectoryExists(null);
      onUpdate(name, { ...variable, value });
    },
    [name, onUpdate, variable]
  );

  const browse = useCallback(async () => {
    const path = await files.pickDirectory();
    if (path) {
      ++directoryCheckIdRef.current;
      setDirectoryExists(true);
      onUpdate(name, {
        ...variable,
        value: normalizeDirectoryPath(path),
      });
    }
  }, [files, name, onUpdate, variable]);

  const reveal = useCallback(async () => {
    try {
      await builtinTools.fsReveal(variable.value);
    } catch (error) {
      toast.error("Failed to reveal folder", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }, [builtinTools, variable.value]);

  return (
    <DetailShell
      icon={<FolderOpenIcon className="text-muted-foreground size-4" />}
      title="Current working directory"
      disabled={disabled}
    >
      <PromptVariableField label="Name">
        <VariableNameInput
          name={name}
          disabled={disabled}
          isAvailable={(next) =>
            isBuiltInNameAvailable(next, name, variables, customNames)
          }
          onCommit={(next) => onRename(name, next)}
        />
      </PromptVariableField>
      <PromptVariableField label="Directory">
        <div className="flex items-center gap-2">
          <Input
            className="h-7 font-mono text-xs"
            value={variable.value}
            disabled={disabled}
            placeholder="~/Desktop/llm-space-project"
            onChange={(event) => handlePathChange(event.currentTarget.value)}
            onBlur={(event) => commitPath(event.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0"
            disabled={disabled}
            onClick={() => void browse()}
          >
            <FolderOpenIcon className="size-3.5" />
            Browse…
          </Button>
        </div>
        {directoryExists === true && (
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto w-fit p-0"
            disabled={disabled}
            onClick={() => void reveal()}
          >
            <FolderOpenIcon className="size-3.5" />
            Reveal in Finder
          </Button>
        )}
      </PromptVariableField>
      {directoryExists === false && (
        <p
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
          role="status"
        >
          <TriangleAlertIcon
            className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400"
            aria-hidden="true"
          />
          This folder hasn&apos;t been created yet, but it doesn&apos;t need to
          exist before you continue.
        </p>
      )}
    </DetailShell>
  );
}
