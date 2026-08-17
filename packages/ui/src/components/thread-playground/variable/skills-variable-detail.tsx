"use client";

import type {
  SkillInfo,
  ThreadSkillsVariable,
  ThreadVariable,
} from "@llm-space/core";
import {
  formatSkillsVariable,
  includesAllSkills,
} from "@llm-space/core/thread";
import { ListFilterIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../ui/select";
import { CodeEditor } from "../../code-editor";

import { DetailShell } from "./detail-shell";
import { PromptVariableField } from "./prompt-variable-field";
import {
  PROMPT_SKILLS_FORMATS,
  PROMPT_SKILLS_INDENTS,
} from "./prompt-variable-options";
import { isBuiltInNameAvailable } from "./prompt-variable-utils";
import { SkillSelectionDialog } from "./skill-selection-dialog";
import { VariableNameInput } from "./variable-name-input";

/** Edits the Skills variable and keeps skill selection/preview state local. */
export function SkillsVariableDetail({
  name,
  variable,
  disabled,
  variables,
  customNames,
  skills,
  skillsByName,
  skillsLoading,
  skillsError,
  onRename,
  onUpdate,
}: {
  name: string;
  variable: ThreadSkillsVariable;
  disabled?: boolean;
  variables: Record<string, ThreadVariable>;
  customNames: Set<string>;
  skills: SkillInfo[];
  skillsByName: Map<string, SkillInfo>;
  skillsLoading: boolean;
  skillsError: string | null;
  onRename: (oldName: string, newName: string) => boolean;
  onUpdate: (name: string, variable: ThreadSkillsVariable) => void;
}) {
  const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
  const selectedSkills = variable.skillNames.flatMap((skillName) => {
    const skill = skillsByName.get(skillName);
    return skill ? [skill] : [];
  });
  // Empty selection means "all enabled skills".
  const usingAllSkills = includesAllSkills(variable);
  const someMissing =
    !usingAllSkills && selectedSkills.length !== variable.skillNames.length;
  const preview =
    skillsError ??
    (someMissing
      ? "Some selected skills are no longer enabled."
      : formatSkillsVariable(
          usingAllSkills ? skills : selectedSkills,
          variable
        ));

  const update = (next: Partial<ThreadSkillsVariable>) => {
    onUpdate(name, { ...variable, ...next });
  };

  return (
    <DetailShell
      icon={<SparklesIcon className="text-muted-foreground size-4" />}
      title="Available skills"
      disabled={disabled}
      action={
        <Button
          className="text-muted-foreground hover:text-foreground focus-visible:text-foreground"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setSkillsDialogOpen(true)}
        >
          <ListFilterIcon className="size-3.5" />
          Select skills
        </Button>
      }
      className="flex h-full flex-col"
      contentClassName="flex min-h-0 grow flex-col"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
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
            onValueChange={(format: ThreadSkillsVariable["format"]) =>
              update({ format })
            }
          >
            <SelectTrigger className="w-full" aria-label="Skills format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_SKILLS_FORMATS.map((format) => (
                <SelectItem key={format.value} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PromptVariableField>
        <PromptVariableField label="Indent">
          <Select
            value={String(variable.indent)}
            disabled={disabled}
            onValueChange={(indent) => update({ indent: Number(indent) })}
          >
            <SelectTrigger className="w-full" aria-label="Skills indentation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROMPT_SKILLS_INDENTS.map((indent) => (
                <SelectItem key={indent} value={String(indent)}>
                  {indent === 0 ? "Default" : `${indent} spaces`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PromptVariableField>
      </div>
      <PromptVariableField label="Value" className="flex min-h-0 grow flex-col">
        <CodeEditor
          className={cn(
            "min-h-32 grow",
            (skillsLoading || Boolean(skillsError) || someMissing) &&
              "opacity-60"
          )}
          language="markdown"
          readonly
          value={skillsLoading ? "Loading skills..." : preview}
        />
      </PromptVariableField>
      <SkillSelectionDialog
        open={skillsDialogOpen}
        disabled={disabled}
        loading={skillsLoading}
        error={skillsError}
        skills={skills}
        selectedSkillNames={variable.skillNames}
        includeAllSkills={usingAllSkills}
        onOpenChange={setSkillsDialogOpen}
        onApply={(skillNames, includeAll) => update({ skillNames, includeAll })}
      />
    </DetailShell>
  );
}
