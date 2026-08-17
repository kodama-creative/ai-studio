"use client";

import type {
  SkillInfo,
  ThreadCurrentDateVariable,
  ThreadVariable,
} from "@llm-space/core";
import {
  DEFAULT_VARIABLE_VARIANT_NAME,
  hasThreadPromptVariableReference,
  includesAllSkills,
  normalizePromptVariableState,
} from "@llm-space/core/thread";
import {
  BracesIcon,
  CalendarDaysIcon,
  FileTextIcon,
  FolderOpenIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHostServices } from "../../../host";
import { cn } from "../../../lib/utils";
import { Button } from "../../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu";
import { ScrollArea } from "../../../ui/scroll-area";
import { ConfirmDialog } from "../../confirm-dialog";
import { Tooltip } from "../../tooltip";
import { useThreadStore, useThreadStoreActions } from "../stores";

import { VariableDetail } from "./prompt-variable-detail";
import { PROMPT_DATE_FORMATS } from "./prompt-variable-options";
import { listEnabledPromptVariableSkills } from "./prompt-variable-skills";
import {
  customVariableNames,
  jsonStatus,
  selectionExists,
  uniqueName,
  type PromptVariableSelection,
} from "./prompt-variable-utils";

export type { PromptVariableSelection } from "./prompt-variable-utils";

interface PromptVariablesPanelProps {
  className?: string;
  disabled?: boolean;
  initialSelection?: PromptVariableSelection | null;
}

type VariableListItem =
  | {
      kind: "builtIn";
      name: string;
      variable: ThreadVariable;
      status: string;
      warning?: boolean;
    }
  | {
      kind: "custom";
      name: string;
      value: string;
      status: string;
      warning?: boolean;
    };

function _PromptVariablesPanel({
  className,
  disabled,
  initialSelection,
}: PromptVariablesPanelProps) {
  const { skills: skillsHost } = useHostServices();
  const rawVariables = useThreadStore((s) => s.thread.context?.variables);
  const rawVariableVariants = useThreadStore(
    (s) => s.thread.context?.variableVariants
  );
  const systemPrompt = useThreadStore(
    (s) => s.thread.context?.systemPrompt ?? ""
  );
  const messages = useThreadStore((s) => s.thread.context?.messages);
  const {
    updatePromptVariable,
    removePromptVariable,
    renamePromptVariable,
    addCustomVariable,
    updateCustomVariable,
    renameCustomVariable,
    removeCustomVariable,
  } = useThreadStoreActions();

  const { variables, variableVariants } = useMemo(
    () =>
      normalizePromptVariableState({
        variables: rawVariables,
        variableVariants: rawVariableVariants,
      }),
    [rawVariables, rawVariableVariants]
  );
  const customNames = useMemo(
    () =>
      customVariableNames(
        variableVariants.variants[DEFAULT_VARIABLE_VARIANT_NAME] ?? {}
      ),
    [variableVariants]
  );
  const customValues = useMemo(
    () => variableVariants.variants[DEFAULT_VARIABLE_VARIANT_NAME] ?? {},
    [variableVariants]
  );

  // Seed from the chip-open target so the fallback effect below (which runs in
  // the same mount commit) doesn't clobber it back to the first variable.
  const [selection, setSelection] = useState<PromptVariableSelection | null>(
    () =>
      initialSelection &&
      selectionExists(initialSelection, variables, customValues)
        ? initialSelection
        : null
  );
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{
    name: string;
    hasReferences: boolean;
    onConfirm: () => void;
  } | null>(null);
  const initialSelectionKey = initialSelection
    ? `${initialSelection.kind}:${initialSelection.name}`
    : null;
  const appliedInitialSelectionKeyRef = useRef<string | null>(null);

  const skillsByName = useMemo(
    () => new Map(skills.map((skill) => [skill.name, skill])),
    [skills]
  );

  const { builtInItems, typedItems, customItems } = useMemo(() => {
    const builtInItems: VariableListItem[] = [];
    const typedItems: VariableListItem[] = [];
    for (const [name, variable] of Object.entries(variables)) {
      if (variable.type === "currentDate") {
        builtInItems.push({
          kind: "builtIn",
          name,
          variable,
          status: _dateFormatLabel(variable.format),
        });
        continue;
      }
      if (variable.type === "workingDirectory") {
        builtInItems.push({
          kind: "builtIn",
          name,
          variable,
          status: variable.value.trim() || "(empty)",
        });
        continue;
      }
      if (variable.type === "json") {
        typedItems.push({
          kind: "builtIn",
          name,
          variable,
          status: jsonStatus(variable.value),
        });
        continue;
      }
      if (variable.type === "file") {
        typedItems.push({
          kind: "builtIn",
          name,
          variable,
          status: variable.value.trim() || "(no file)",
        });
        continue;
      }
      const selectedCount = variable.skillNames.length;
      const missingCount = variable.skillNames.filter(
        (skillName) => !skillsByName.has(skillName)
      ).length;
      builtInItems.push({
        kind: "builtIn",
        name,
        variable,
        status: includesAllSkills(variable)
          ? "All skills"
          : selectedCount === 0
            ? "None selected"
            : missingCount > 0
              ? `${missingCount} missing`
              : `${selectedCount} selected`,
        warning: missingCount > 0 || Boolean(skillsError),
      });
    }
    const custom: VariableListItem[] = Object.entries(customValues).map(
      ([name, value]) => ({
        kind: "custom",
        name,
        value,
        status: value.trim() ? value : "(empty)",
      })
    );
    return { builtInItems, typedItems, customItems: custom };
  }, [customValues, skillsByName, skillsError, variables]);

  // Apply a chip-open target once, then let in-dialog selection stay user-owned
  // across variable edits.
  useEffect(() => {
    if (!initialSelectionKey) {
      appliedInitialSelectionKeyRef.current = null;
      return;
    }
    if (appliedInitialSelectionKeyRef.current === initialSelectionKey) {
      return;
    }
    appliedInitialSelectionKeyRef.current = initialSelectionKey;
    if (
      initialSelection &&
      selectionExists(initialSelection, variables, customValues)
    ) {
      setSelection(initialSelection);
    }
  }, [customValues, initialSelection, initialSelectionKey, variables]);

  // Keep the selected detail stable across edits, but fall back when a selected
  // variable is removed.
  useEffect(() => {
    if (selection && selectionExists(selection, variables, customValues)) {
      return;
    }
    const firstBuiltIn = Object.keys(variables)[0];
    if (firstBuiltIn) {
      setSelection({ kind: "builtIn", name: firstBuiltIn });
      return;
    }
    const firstCustom = Object.keys(customValues)[0];
    setSelection(firstCustom ? { kind: "custom", name: firstCustom } : null);
  }, [customValues, selection, variables]);

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    setSkillsError(null);
    void listEnabledPromptVariableSkills(skillsHost)
      .then((loaded) => {
        if (!cancelled) {
          setSkills(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSkills([]);
          setSkillsError(
            error instanceof Error ? error.message : "Failed to load skills."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skillsHost]);

  const addCustom = useCallback(() => {
    const used = new Set([...Object.keys(variables), ...customNames]);
    const name = uniqueName("custom_variable", used);
    if (addCustomVariable(name, "")) {
      setSelection({ kind: "custom", name });
    }
  }, [addCustomVariable, customNames, variables]);

  const addJson = useCallback(() => {
    const used = new Set([...Object.keys(variables), ...customNames]);
    const name = uniqueName("json_variable", used);
    updatePromptVariable(name, { type: "json", value: "" });
    setSelection({ kind: "builtIn", name });
  }, [customNames, updatePromptVariable, variables]);

  const addFile = useCallback(() => {
    const used = new Set([...Object.keys(variables), ...customNames]);
    const name = uniqueName("file_variable", used);
    updatePromptVariable(name, { type: "file", value: "" });
    setSelection({ kind: "builtIn", name });
  }, [customNames, updatePromptVariable, variables]);

  const confirmRemoveCustom = useCallback(
    (name: string) => {
      setPendingRemove({
        name,
        hasReferences: hasThreadPromptVariableReference(
          { systemPrompt, messages },
          name
        ),
        onConfirm: () => removeCustomVariable(name),
      });
    },
    [messages, removeCustomVariable, systemPrompt]
  );

  // Removes any user-created typed variable (json / file) from context.variables.
  const confirmRemoveTypedVariable = useCallback(
    (name: string) => {
      setPendingRemove({
        name,
        hasReferences: hasThreadPromptVariableReference(
          { systemPrompt, messages },
          name
        ),
        onConfirm: () => removePromptVariable(name),
      });
    },
    [messages, removePromptVariable, systemPrompt]
  );
  const selectedType =
    selection?.kind === "builtIn" ? variables[selection.name]?.type : undefined;
  const detailFillsAvailableHeight =
    selection?.kind === "custom" ||
    selectedType === "skills" ||
    selectedType === "json";

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex min-h-0 grow overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r px-2 py-3">
          <ScrollArea className="min-h-0 grow">
            <div className="grid gap-3">
              <VariableListGroup title="Built-in">
                {builtInItems.map((item) => (
                  <VariableListRow
                    key={`${item.kind}:${item.name}`}
                    item={item}
                    selected={
                      selection?.kind === item.kind &&
                      selection.name === item.name
                    }
                    disabled={disabled}
                    onSelect={() =>
                      setSelection({ kind: item.kind, name: item.name })
                    }
                  />
                ))}
              </VariableListGroup>
              <VariableListGroup
                title="Custom"
                action={
                  <AddVariableMenu
                    disabled={disabled}
                    onAddText={addCustom}
                    onAddJson={addJson}
                    onAddFile={addFile}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground size-6"
                      disabled={disabled}
                      aria-label="Add custom variable"
                    >
                      <PlusIcon className="size-3.5" />
                    </Button>
                  </AddVariableMenu>
                }
              >
                {typedItems.length + customItems.length > 0 ? (
                  [...typedItems, ...customItems].map((item) => (
                    <VariableListRow
                      key={`${item.kind}:${item.name}`}
                      item={item}
                      selected={
                        selection?.kind === item.kind &&
                        selection.name === item.name
                      }
                      disabled={disabled}
                      onSelect={() =>
                        setSelection({ kind: item.kind, name: item.name })
                      }
                      onRemove={() =>
                        item.kind === "custom"
                          ? confirmRemoveCustom(item.name)
                          : confirmRemoveTypedVariable(item.name)
                      }
                    />
                  ))
                ) : (
                  <div className="text-muted-foreground px-2 py-1 text-xs">
                    No custom variables.{" "}
                    <AddVariableMenu
                      disabled={disabled}
                      onAddText={addCustom}
                      onAddJson={addJson}
                      onAddFile={addFile}
                    >
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground focus-visible:text-foreground underline underline-offset-4 disabled:pointer-events-none disabled:opacity-50"
                        disabled={disabled}
                      >
                        Add variable
                      </button>
                    </AddVariableMenu>
                    .
                  </div>
                )}
              </VariableListGroup>
            </div>
          </ScrollArea>
          <AddVariableMenu
            disabled={disabled}
            onAddText={addCustom}
            onAddJson={addJson}
            onAddFile={addFile}
            side="top"
          >
            <Button
              className="text-muted-foreground mt-2 w-full"
              size="sm"
              variant="outline"
              disabled={disabled}
            >
              <PlusIcon className="size-3.5" />
              Add custom variable
            </Button>
          </AddVariableMenu>
        </aside>
        <ScrollArea
          className={cn(
            "min-h-0 min-w-0 grow",
            detailFillsAvailableHeight &&
              "[&_[data-radix-scroll-area-viewport]>div]:!flex [&_[data-radix-scroll-area-viewport]>div]:!h-full"
          )}
        >
          <VariableDetail
            selection={selection}
            disabled={disabled}
            variables={variables}
            customNames={customNames}
            customValues={customValues}
            skills={skills}
            skillsByName={skillsByName}
            skillsLoading={skillsLoading}
            skillsError={skillsError}
            onRenameBuiltIn={(oldName, newName) => {
              const renamed = renamePromptVariable(oldName, newName);
              if (renamed) {
                setSelection({ kind: "builtIn", name: newName });
              }
              return renamed;
            }}
            onUpdateBuiltIn={updatePromptVariable}
            onRenameCustom={(oldName, newName) => {
              const renamed = renameCustomVariable(oldName, newName);
              if (renamed) {
                setSelection({ kind: "custom", name: newName });
              }
              return renamed;
            }}
            onUpdateCustom={updateCustomVariable}
          />
        </ScrollArea>
      </div>
      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemove(null);
          }
        }}
        title="Delete variable?"
        description={
          pendingRemove
            ? pendingRemove.hasReferences
              ? `This thread references "{{${pendingRemove.name}}}". Deleting this variable will leave unresolved placeholders.`
              : `This removes "{{${pendingRemove.name}}}" and its value from this thread.`
            : undefined
        }
        confirmLabel="Delete variable"
        onConfirm={() => {
          pendingRemove?.onConfirm();
          setPendingRemove(null);
        }}
      />
    </section>
  );
}

function VariableListGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <div className="text-muted-foreground flex min-h-6 items-center justify-between gap-2 px-2 text-[0.6875rem] font-medium tracking-wide uppercase">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function AddVariableMenu({
  disabled,
  onAddText,
  onAddJson,
  onAddFile,
  side,
  children,
}: {
  disabled?: boolean;
  onAddText: () => void;
  onAddJson: () => void;
  onAddFile: () => void;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} sideOffset={4}>
        <DropdownMenuItem onSelect={onAddText}>
          <TypeIcon className="size-3.5" />
          Text
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddJson}>
          <BracesIcon className="size-3.5" />
          JSON
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddFile}>
          <FileTextIcon className="size-3.5" />
          File content
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VariableListRow({
  item,
  selected,
  disabled,
  onSelect,
  onRemove,
}: {
  item: VariableListItem;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        "group/variable-row relative rounded-md border border-transparent transition-all",
        selected
          ? "border-primary/25 bg-primary/10 text-primary dark:border-input dark:bg-input/30 dark:text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
        item.warning && !selected && "text-destructive"
      )}
    >
      <button
        type="button"
        className={cn(
          "focus-visible:ring-ring/30 flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs outline-none focus-visible:ring-2",
          onRemove && "pr-8"
        )}
        disabled={disabled}
        aria-pressed={selected}
        title={item.name}
        onClick={onSelect}
      >
        {_variableIcon(item)}
        <span className="min-w-0 grow truncate font-mono">{item.name}</span>
      </button>
      {onRemove ? (
        <Tooltip content="Delete variable">
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:ring-ring/30 absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded opacity-0 transition-opacity outline-none group-hover/variable-row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
            aria-label={`Delete ${item.name}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function _variableIcon(item: VariableListItem): ReactNode {
  if (item.kind === "custom") {
    return <TypeIcon className="size-3.5 shrink-0" />;
  }
  if (item.variable.type === "currentDate") {
    return <CalendarDaysIcon className="size-3.5 shrink-0" />;
  }
  if (item.variable.type === "workingDirectory") {
    return <FolderOpenIcon className="size-3.5 shrink-0" />;
  }
  if (item.variable.type === "json") {
    return <BracesIcon className="size-3.5 shrink-0" />;
  }
  if (item.variable.type === "file") {
    return <FileTextIcon className="size-3.5 shrink-0" />;
  }
  return <SparklesIcon className="size-3.5 shrink-0" />;
}

function _dateFormatLabel(value: ThreadCurrentDateVariable["format"]): string {
  return (
    PROMPT_DATE_FORMATS.find((format) => format.value === value)?.label ?? value
  );
}

export const PromptVariablesPanel = memo(_PromptVariablesPanel);
