"use client";

import type {
  SkillInfo,
  ThreadCurrentDateVariable,
  ThreadJsonVariable,
  ThreadVariable,
} from "@llm-space/core";
import { formatCurrentDateVariable } from "@llm-space/core/thread";
import { BracesIcon, CalendarDaysIcon, TypeIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../ui/select";
import { CodeEditor } from "../../code-editor";

import { DetailShell } from "./detail-shell";
import { FileVariableDetail } from "./file-variable-detail";
import { PromptVariableField } from "./prompt-variable-field";
import { PROMPT_DATE_FORMATS } from "./prompt-variable-options";
import { PromptVariablePreview } from "./prompt-variable-preview";
import {
  isBuiltInNameAvailable,
  isCustomNameAvailable,
  jsonError,
  type PromptVariableSelection,
} from "./prompt-variable-utils";
import { SkillsVariableDetail } from "./skills-variable-detail";
import { VariableNameInput } from "./variable-name-input";
import { WorkingDirectoryVariableDetail } from "./working-directory-variable-detail";

/** Dispatches the selected variable to one focused detail editor. */
export function VariableDetail({
  selection,
  disabled,
  variables,
  customNames,
  customValues,
  skills,
  skillsByName,
  skillsLoading,
  skillsError,
  onRenameBuiltIn,
  onUpdateBuiltIn,
  onRenameCustom,
  onUpdateCustom,
}: {
  selection: PromptVariableSelection | null;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  customValues: Record<string, string>;
  skills: SkillInfo[];
  skillsByName: Map<string, SkillInfo>;
  skillsLoading: boolean;
  skillsError: string | null;
  onRenameBuiltIn: (oldName: string, newName: string) => boolean;
  onUpdateBuiltIn: (name: string, variable: ThreadVariable) => void;
  onRenameCustom: (oldName: string, newName: string) => boolean;
  onUpdateCustom: (name: string, value: string) => void;
}) {
  if (!selection) {
    return (
      <div className="text-muted-foreground p-3 text-xs">
        Add a custom variable to provide a reusable value.
      </div>
    );
  }

  if (selection.kind === "custom") {
    const value = customValues[selection.name];
    if (value === undefined) {
      return (
        <div className="text-muted-foreground p-3 text-xs">
          Select a variable to edit.
        </div>
      );
    }
    return (
      <CustomVariableDetail
        name={selection.name}
        value={value}
        disabled={disabled}
        variables={variables}
        customNames={customNames}
        onRename={onRenameCustom}
        onUpdate={onUpdateCustom}
      />
    );
  }

  const variable = variables[selection.name];
  if (!variable) {
    return (
      <div className="text-muted-foreground p-3 text-xs">
        Select a variable to edit.
      </div>
    );
  }

  if (variable.type === "currentDate") {
    return (
      <CurrentDateVariableDetail
        name={selection.name}
        variable={variable}
        disabled={disabled}
        variables={variables}
        customNames={customNames}
        onRename={onRenameBuiltIn}
        onUpdate={(name, next) => onUpdateBuiltIn(name, next)}
      />
    );
  }

  if (variable.type === "workingDirectory") {
    return (
      <WorkingDirectoryVariableDetail
        name={selection.name}
        variable={variable}
        disabled={disabled}
        variables={variables}
        customNames={customNames}
        onRename={onRenameBuiltIn}
        onUpdate={(name, next) => onUpdateBuiltIn(name, next)}
      />
    );
  }

  if (variable.type === "json") {
    return (
      <JsonVariableDetail
        name={selection.name}
        variable={variable}
        disabled={disabled}
        variables={variables}
        customNames={customNames}
        onRename={onRenameBuiltIn}
        onUpdate={(name, next) => onUpdateBuiltIn(name, next)}
      />
    );
  }

  if (variable.type === "file") {
    return (
      <FileVariableDetail
        name={selection.name}
        variable={variable}
        disabled={disabled}
        variables={variables}
        customNames={customNames}
        onRename={onRenameBuiltIn}
        onUpdate={(name, next) => onUpdateBuiltIn(name, next)}
      />
    );
  }

  return (
    <SkillsVariableDetail
      name={selection.name}
      variable={variable}
      disabled={disabled}
      variables={variables}
      customNames={customNames}
      skills={skills}
      skillsByName={skillsByName}
      skillsLoading={skillsLoading}
      skillsError={skillsError}
      onRename={onRenameBuiltIn}
      onUpdate={(name, next) => onUpdateBuiltIn(name, next)}
    />
  );
}

/** Edits the current-date name/format and previews the resolved value. */
function CurrentDateVariableDetail({
  name,
  variable,
  disabled,
  variables,
  customNames,
  onRename,
  onUpdate,
}: {
  name: string;
  variable: ThreadCurrentDateVariable;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  onRename: (oldName: string, newName: string) => boolean;
  onUpdate: (name: string, variable: ThreadCurrentDateVariable) => void;
}) {
  return (
    <DetailShell
      icon={<CalendarDaysIcon className="text-muted-foreground size-4" />}
      title="Current date"
      disabled={disabled}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
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
        <PromptVariableField label="Format">
          <Select
            value={variable.format}
            disabled={disabled}
            onValueChange={(format: ThreadCurrentDateVariable["format"]) =>
              onUpdate(name, { ...variable, format })
            }
          >
            <SelectTrigger className="w-full" aria-label="Current date format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_DATE_FORMATS.map((format) => (
                <SelectItem key={format.value} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PromptVariableField>
      </div>
      <PromptVariableField label="Value">
        <PromptVariablePreview
          value={formatCurrentDateVariable(variable.format)}
        />
      </PromptVariableField>
    </DetailShell>
  );
}

/** Edits one plain custom variable without touching typed-variable state. */
function CustomVariableDetail({
  name,
  value,
  disabled,
  variables,
  customNames,
  onRename,
  onUpdate,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  onRename: (oldName: string, newName: string) => boolean;
  onUpdate: (name: string, value: string) => void;
}) {
  return (
    <DetailShell
      icon={<TypeIcon className="text-muted-foreground size-4" />}
      title="User defined variable"
      disabled={disabled}
      className="flex h-full flex-col"
      contentClassName="flex min-h-0 grow flex-col"
    >
      <PromptVariableField label="Name">
        <VariableNameInput
          name={name}
          disabled={disabled}
          isAvailable={(next) =>
            isCustomNameAvailable(next, name, variables, customNames)
          }
          onCommit={(next) => onRename(name, next)}
        />
      </PromptVariableField>
      <PromptVariableField label="Value" className="flex min-h-0 grow flex-col">
        <CodeEditor
          className="min-h-32 grow"
          language="markdown"
          value={value}
          readonly={disabled}
          placeholder="Variable value"
          onChange={(next) => onUpdate(name, next)}
        />
      </PromptVariableField>
    </DetailShell>
  );
}

/** Edits a JSON variable and reports parse feedback without blocking drafts. */
function JsonVariableDetail({
  name,
  variable,
  disabled,
  variables,
  customNames,
  onRename,
  onUpdate,
}: {
  name: string;
  variable: ThreadJsonVariable;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  onRename: (oldName: string, newName: string) => boolean;
  onUpdate: (name: string, variable: ThreadVariable) => void;
}) {
  const error = jsonError(variable.value);
  return (
    <DetailShell
      icon={<BracesIcon className="text-muted-foreground size-4" />}
      title="JSON variable"
      disabled={disabled}
      className="flex h-full flex-col"
      contentClassName="flex min-h-0 grow flex-col"
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
      <PromptVariableField
        label="Value (JSON)"
        className="flex min-h-0 grow flex-col"
      >
        <CodeEditor
          language="json"
          value={variable.value}
          readonly={disabled}
          placeholder={'{ "key": "value" }'}
          className="min-h-32 grow"
          onChange={(next) => onUpdate(name, { ...variable, value: next })}
        />
      </PromptVariableField>
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Use it in templates, e.g. {"{% if data.enabled %}"},{" "}
          {"{% for x in data.items %}"}, {"{{ data.name }}"}.
        </p>
      )}
    </DetailShell>
  );
}
