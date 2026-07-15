import {
  DEFAULT_VARIABLE_VARIANT_NAME,
  formatCurrentDateVariable,
  formatSkillsVariable,
  normalizePromptVariableState,
  type PromptSkill,
  VARIABLE_NAME_RE
} from "@llm-space/core/thread";

import type { ThreadContext, ThreadSkillsVariable } from "@llm-space/core";

export interface PromptVariableCompletion {
  name: string;
  hint: string;
}

export type VariableResolution =
  | { name: string; status: "empty"; }
  | { name: string; status: "invalid"; }
  | { name: string; status: "unknown"; }
  | { status: "ok"; value: string; };

export function resolvePromptVariableValueSync(
  name: string,
  context: ThreadContext | undefined
):
  | { status: "needsSkills"; variable: ThreadSkillsVariable; }
  | VariableResolution {
  if (!VARIABLE_NAME_RE.test(name)) {
    return { status: "invalid", name };
  }
  const state = normalizePromptVariableState(context);
  const builtIn = state.variables[name];
  if (builtIn?.type === "currentDate") {
    return { status: "ok", value: formatCurrentDateVariable(builtIn.format) };
  }
  if (builtIn?.type === "skills") {
    return { status: "needsSkills", variable: builtIn };
  }
  const customValues =
    state.variableVariants.variants[DEFAULT_VARIABLE_VARIANT_NAME] ?? {};
  if (!(name in customValues)) {
    return { status: "unknown", name };
  }
  const raw = customValues[name];
  return raw?.trim() ? { status: "ok", value: raw } : { status: "empty", name };
}

export async function resolvePromptVariableValue(
  name: string,
  context: ThreadContext | undefined,
  loadSkills: () => Promise<PromptSkill[]>
): Promise<VariableResolution> {
  const fast = resolvePromptVariableValueSync(name, context);
  if (fast.status !== "needsSkills") {
    return fast;
  }
  try {
    const all = await loadSkills();
    const byName = new Map(all.map(skill => [skill.name, skill]));
    const selected =
      fast.variable.skillNames.length === 0
        ? all
        : fast.variable.skillNames.flatMap(skillName => {
          const skill = byName.get(skillName);
          return skill ? [skill] : [];
        });
    const value = formatSkillsVariable(selected, fast.variable);
    return value.trim() ? { status: "ok", value } : { status: "empty", name };
  } catch {
    return { status: "unknown", name };
  }
}

export async function resolvePromptVariableValueForPlace(
  name: string,
  context: ThreadContext | undefined,
  placeKey: string | undefined,
  loadSkills: () => Promise<PromptSkill[]>
): Promise<VariableResolution> {
  if (!VARIABLE_NAME_RE.test(name)) {
    return Promise.resolve({ status: "invalid", name });
  }
  const frozen =
    placeKey === undefined
      ? undefined
      : context?.snapshot?.variables?.[placeKey]?.[name];
  if (frozen !== undefined) {
    return Promise.resolve({ status: "ok", value: frozen });
  }
  return resolvePromptVariableValue(name, context, loadSkills);
}

export function listPromptVariableCompletions(
  context: ThreadContext | undefined
): PromptVariableCompletion[] {
  const state = normalizePromptVariableState(context);
  const items: PromptVariableCompletion[] = [];
  for (const [name, variable] of Object.entries(state.variables)) {
    const hint =
      variable.type === "currentDate"
        ? formatCurrentDateVariable(variable.format)
        : variable.skillNames.length === 0
          ? "All enabled skills"
          : `${variable.skillNames.length} selected skill${
            variable.skillNames.length === 1 ? "" : "s"
          }`;
    items.push({ name, hint });
  }
  const customValues =
    state.variableVariants.variants[DEFAULT_VARIABLE_VARIANT_NAME] ?? {};
  for (const [name, value] of Object.entries(customValues)) {
    items.push({ name, hint: value.trim() ? _singleLine(value) : "(empty)" });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function _singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
