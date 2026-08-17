import type { ThreadVariable } from "@llm-space/core";
import { VARIABLE_NAME_RE } from "@llm-space/core/thread";

/** Identifies either a typed/built-in variable or a plain custom variable. */
export type PromptVariableSelection =
  { kind: "builtIn"; name: string } | { kind: "custom"; name: string };

/** Trim user input and remove trailing separators without changing roots. */
export function normalizeDirectoryPath(value: string): string {
  const trimmed = value.trim();
  if (/^\/+$/.test(trimmed)) {
    return "/";
  }
  if (/^\\+$/.test(trimmed)) {
    return "\\";
  }
  if (/^[A-Za-z]:[\\/]$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/[\\/]+$/, "");
}

/** A JSON parse error message for the editor, or `null` when valid/empty. */
export function jsonError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    JSON.parse(trimmed);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON.";
  }
}

/** The list-row status line for a JSON variable. */
export function jsonStatus(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "(empty)";
  }
  return jsonError(trimmed) ? "Invalid JSON" : trimmed.replace(/\s+/g, " ");
}

/** Whether a selection still points at either variable persistence collection. */
export function selectionExists(
  selection: PromptVariableSelection,
  variables: Record<string, ThreadVariable>,
  customValues: Record<string, string>
): boolean {
  if (selection.kind === "builtIn") {
    return Object.prototype.hasOwnProperty.call(variables, selection.name);
  }
  return Object.prototype.hasOwnProperty.call(customValues, selection.name);
}

/** Snapshot the custom-variable keys into the collision-checking name set. */
export function customVariableNames(
  values: Record<string, string>
): Set<string> {
  return new Set(Object.keys(values));
}

/** Whether a name satisfies the template variable identifier grammar. */
export function isVariableNameValid(name: string): boolean {
  return VARIABLE_NAME_RE.test(name);
}

/** Whether a typed variable can adopt a name without crossing either namespace. */
export function isBuiltInNameAvailable(
  name: string,
  currentName: string,
  variables: Record<string, ThreadVariable>,
  customNames: Set<string>
): boolean {
  return (
    isVariableNameValid(name) &&
    (name === currentName ||
      (!Object.prototype.hasOwnProperty.call(variables, name) &&
        !customNames.has(name)))
  );
}

/** Whether a custom variable can adopt a name without crossing either namespace. */
export function isCustomNameAvailable(
  name: string,
  currentName: string,
  variables: Record<string, ThreadVariable>,
  customNames: Set<string>
): boolean {
  return (
    isVariableNameValid(name) &&
    !Object.prototype.hasOwnProperty.call(variables, name) &&
    (name === currentName || !customNames.has(name))
  );
}

/** Choose the first deterministic `base_N` name not present in `used`. */
export function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}
