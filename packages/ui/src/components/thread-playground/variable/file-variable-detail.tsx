"use client";

import type { ThreadFileVariable, ThreadVariable } from "@llm-space/core";
import { FileTextIcon, FolderOpenIcon } from "lucide-react";
import { useCallback } from "react";

import { useHostServices } from "../../../host";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";

import { DetailShell } from "./detail-shell";
import { PromptVariableField } from "./prompt-variable-field";
import { isBuiltInNameAvailable } from "./prompt-variable-utils";
import { VariableNameInput } from "./variable-name-input";

/** Edits a file-backed variable and delegates file picking to HostServices. */
export function FileVariableDetail({
  name,
  variable,
  disabled,
  variables,
  customNames,
  onRename,
  onUpdate,
}: {
  name: string;
  variable: ThreadFileVariable;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  onRename: (oldName: string, newName: string) => boolean;
  onUpdate: (name: string, variable: ThreadVariable) => void;
}) {
  const { files } = useHostServices();
  const browse = useCallback(async () => {
    const path = await files.pickFile();
    if (path) {
      onUpdate(name, { ...variable, value: path });
    }
  }, [files, name, onUpdate, variable]);

  return (
    <DetailShell
      icon={<FileTextIcon className="text-muted-foreground size-4" />}
      title="File content variable"
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
      <PromptVariableField label="File path">
        <div className="flex items-center gap-2">
          <Input
            className="h-7 font-mono text-xs"
            value={variable.value}
            disabled={disabled}
            placeholder="~/notes/style.md"
            onChange={(event) =>
              onUpdate(name, { ...variable, value: event.currentTarget.value })
            }
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
      </PromptVariableField>
      <p className="text-muted-foreground text-xs">
        Inlines the file contents at run time (a missing file → empty). For
        recursive rendering, use {'{{@include("...")}}'} instead.
      </p>
    </DetailShell>
  );
}
