import { runtimeSessionBudgetView } from "@llm-space/runtime/harness";

import type { AgentSessionLimitsDefinition } from "@llm-space/runtime";
import type {
  RuntimeSessionBudgetWaitSnapshot,
  StoredRuntimeSession
} from "@llm-space/runtime/harness";

const TOKEN_FORMATTER = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
  notation: "compact"
});

export interface SessionBudgetPresentation {
  readonly inputBaseline: number;
  readonly inputTokens: number;
  readonly limits?: AgentSessionLimitsDefinition;
  readonly outputBaseline: number;
  readonly outputTokens: number;
  readonly unmeteredProviderCalls: number;
  readonly wait: ReturnType<typeof runtimeSessionBudgetView>["wait"];
}

export function sessionBudgetPresentation(
  persisted: unknown,
  sourceLimits?: AgentSessionLimitsDefinition
): SessionBudgetPresentation | null {
  try {
    const session = persisted as StoredRuntimeSession | undefined;
    if (session?.snapshot.schemaVersion !== 5) {
      return sourceLimits ? {
        inputBaseline: 0,
        inputTokens: 0,
        limits: sourceLimits,
        outputBaseline: 0,
        outputTokens: 0,
        unmeteredProviderCalls: 0,
        wait: null
      } : null;
    }
    const budget = runtimeSessionBudgetView(session);
    const activeRun = session.snapshot.runs.find(
      run => run.id === session.snapshot.activeRunId
    );
    const configuration = activeRun
      ? session.configurations.find(item => item.id === activeRun.configurationId)
      : session.configurations.at(-1);
    return {
      ...budget,
      limits: configuration?.limits ?? sourceLimits
    };
  } catch {
    return null;
  }
}

export function compactSessionBudgetWindowLabel(
  input: number,
  output: number,
  limits?: AgentSessionLimitsDefinition
): string {
  return [
    _axisLabel(input, limits?.maxInputTokensPerSession, "in"),
    _axisLabel(output, limits?.maxOutputTokensPerSession, "out")
  ].join(" · ");
}

export function formatSessionBudgetTokens(value: number): string {
  return TOKEN_FORMATTER.format(value).toLowerCase();
}

export function hasNumericSessionBudgetLimit(
  limits: AgentSessionLimitsDefinition | undefined
): boolean {
  return typeof limits?.maxInputTokensPerSession === "number"
    || typeof limits?.maxOutputTokensPerSession === "number";
}

export function pendingSessionBudgetWait(
  persisted: unknown
): RuntimeSessionBudgetWaitSnapshot | null {
  try {
    const session = persisted as StoredRuntimeSession | undefined;
    if (session?.snapshot.schemaVersion !== 5) { return null; }
    const wait = session.snapshot.budget?.waits.at(-1);
    return wait?.status === "waiting" ? wait : null;
  } catch {
    return null;
  }
}

export function focusSessionBudgetPrimaryAction(container: ParentNode): boolean {
  const action = container.querySelector<HTMLElement>(
    "[data-session-budget-primary-action]"
  );
  action?.focus();
  return Boolean(action);
}

export function sessionBudgetWaitStatusLabel(
  status: "granted" | "stopped" | "waiting"
): string {
  if (status === "granted") { return "fresh budget granted"; }
  if (status === "stopped") { return "Run stopped"; }
  return "decision required";
}

function _axisLabel(
  value: number,
  limit: false | number | undefined,
  suffix: "in" | "out"
): string {
  return `${formatSessionBudgetTokens(value)} / ${typeof limit === "number"
    ? formatSessionBudgetTokens(limit)
    : "Unlimited"} ${suffix}`;
}
