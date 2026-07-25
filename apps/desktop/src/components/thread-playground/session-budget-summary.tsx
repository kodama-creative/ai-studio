import { GaugeIcon } from "lucide-react";
import { memo, useMemo } from "react";

import type { AgentSessionLimitsDefinition } from "@llm-space/runtime";

import { cn } from "@/lib/utils";
import {
  compactSessionBudgetWindowLabel,
  formatSessionBudgetTokens,
  hasNumericSessionBudgetLimit,
  sessionBudgetPresentation,
  sessionBudgetWaitStatusLabel
} from "./session-budget-view";
import { useThreadStore } from "./stores";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "../ui/popover";

const SessionBudgetSummaryImpl = function SessionBudgetSummaryImpl({
  limits
}: {
  readonly limits?: AgentSessionLimitsDefinition;
}) {
  const persisted = useThreadStore(state => state.thread.runtimeSession);
  const view = useMemo(
    () => sessionBudgetPresentation(persisted, limits),
    [limits, persisted]
  );
  if (!view) { return null; }
  const inputWindow = view.inputTokens - view.inputBaseline;
  const outputWindow = view.outputTokens - view.outputBaseline;
  const activeLimits = view.wait?.status === "waiting"
    ? view.wait.limits
    : view.limits;
  if (!hasNumericSessionBudgetLimit(activeLimits)) { return null; }
  const label = compactSessionBudgetWindowLabel(
    inputWindow,
    outputWindow,
    activeLimits
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`Session token budget: ${label}`}
          className={cn(
            "text-muted-foreground bg-foreground/4 hover:text-foreground flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-[0.5625rem] transition-colors",
            view.wait?.status === "waiting" && "bg-amber-500/12 text-amber-400"
          )}
          type="button"
        >
          <GaugeIcon className="size-3 shrink-0" />
          <span className="max-w-40 truncate font-mono tabular-nums">
            {label}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3">
        <div>
          <div className="text-foreground font-medium">Session token budget</div>
          <div className="text-muted-foreground mt-0.5">
            Settled main-provider usage. Model changes do not reset this window.
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
          <BudgetRow
            label="Current input window"
            limit={activeLimits?.maxInputTokensPerSession}
            value={inputWindow}
          />
          <BudgetRow
            label="Current output window"
            limit={activeLimits?.maxOutputTokensPerSession}
            value={outputWindow}
          />
          <BudgetRow label="Lifetime input" value={view.inputTokens} />
          <BudgetRow label="Lifetime output" value={view.outputTokens} />
          <div className="text-muted-foreground">Unmetered calls</div>
          <div className="text-right font-mono tabular-nums">
            {view.unmeteredProviderCalls}
          </div>
        </div>
        {view.wait
          ? (
            <div className="border-border text-muted-foreground border-t pt-2">
              Latest boundary: {sessionBudgetWaitStatusLabel(view.wait.status)}
            </div>
          )
          : null}
        <div className="text-muted-foreground border-border border-t pt-2">
          Limits are read from Agent source.
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const SessionBudgetSummary = memo(SessionBudgetSummaryImpl);

function BudgetRow({
  label,
  limit,
  value
}: {
  readonly label: string;
  readonly limit?: false | number;
  readonly value: number;
}) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className="text-right font-mono tabular-nums">
        {formatSessionBudgetTokens(value)}{limit !== undefined
          ? ` / ${typeof limit === "number"
            ? formatSessionBudgetTokens(limit)
            : "Unlimited"}`
          : ""}
      </div>
    </>
  );
}
