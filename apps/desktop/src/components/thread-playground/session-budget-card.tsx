import { OctagonPauseIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import {
  formatSessionBudgetTokens,
  sessionBudgetPresentation
} from "./session-budget-view";
import { useThreadStore, useThreadStoreActions } from "./stores";
import { Button } from "../ui/button";

const SessionBudgetCardImpl = function SessionBudgetCardImpl() {
  const persisted = useThreadStore(state => state.thread.runtimeSession);
  const { decideSessionBudget } = useThreadStoreActions();
  const view = useMemo(
    () => sessionBudgetPresentation(persisted),
    [persisted]
  );
  const wait = view?.wait ?? null;
  const headingId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const previousWaitStatus = useRef(wait?.status);
  const [confirmation, setConfirmation] = useState<
    "freshWindow" | "stop" | null
  >(null);
  const [pendingDecision, setPendingDecision] = useState<
    "freshWindow" | "stop" | null
  >(null);

  useEffect(() => {
    if (wait?.status !== "waiting") { return; }
    cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [wait?.id, wait?.status]);

  useEffect(() => {
    const previous = previousWaitStatus.current;
    previousWaitStatus.current = wait?.status;
    if (previous !== "waiting" || wait?.status === "waiting") { return; }
    const frame = requestAnimationFrame(() => cardRef.current?.focus());
    return () => { cancelAnimationFrame(frame); };
  }, [wait?.status]);

  const confirmDecision = useCallback(async () => {
    if (!wait || !confirmation) { return; }
    const decision = confirmation;
    setConfirmation(null);
    setPendingDecision(decision);
    try {
      await decideSessionBudget(wait.id, decision);
    } catch (error) {
      toast.error("Unable to apply Session budget decision", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setPendingDecision(null);
    }
  }, [confirmation, decideSessionBudget, wait]);

  if (!wait || !view) { return null; }
  const waiting = wait.status === "waiting";
  const reached = wait.reached.map(axis => (axis === "input"
    ? "input tokens"
    : "output tokens")).join(" and ");
  return (
    <>
      <div
        aria-labelledby={headingId}
        aria-live="polite"
        className={cn(
          "mb-3.5 flex scroll-m-3 flex-col gap-3 rounded-lg border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          waiting
            ? "border-amber-500/45 bg-amber-500/8"
            : "border-border bg-muted/35"
        )}
        data-session-budget-card
        ref={cardRef}
        role="region"
        tabIndex={-1}
      >
        <div className="flex items-start gap-2.5">
          <OctagonPauseIcon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              waiting ? "text-amber-400" : "text-muted-foreground"
            )}
          />
          <div className="min-w-0 flex-1">
            <div
              className="text-xs font-medium"
              id={headingId}
            >
              {waiting
                ? "Session budget reached"
                : wait.status === "granted"
                  ? "Fresh budget granted"
                  : "Run stopped at budget boundary"}
            </div>
            <p className="text-muted-foreground mt-1 text-[0.6875rem] leading-relaxed">
              {waiting
                ? `This Run reached its ${reached} limit. The crossing provider turn and completed tool batch are kept.`
                : wait.status === "granted"
                  ? "Lifetime usage was retained and a fresh input/output window resumed the same Run."
                  : "The active Run was cancelled. Session usage and editable Thread state were retained."}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[0.625rem]">
          <BudgetMetric
            label={waiting ? "Input window" : "Reached input window"}
            limit={wait.limits.maxInputTokensPerSession}
            value={wait.window.input}
          />
          <BudgetMetric
            label={waiting ? "Output window" : "Reached output window"}
            limit={wait.limits.maxOutputTokensPerSession}
            value={wait.window.output}
          />
        </div>
        <p className="text-muted-foreground text-[0.625rem] font-mono tabular-nums">
          Lifetime · {formatSessionBudgetTokens(wait.lifetime.input)} input · {formatSessionBudgetTokens(wait.lifetime.output)} output
        </p>
        {wait.unmeteredProviderCalls > 0
          ? (
            <p className="text-muted-foreground text-[0.625rem]">
              {wait.unmeteredProviderCalls} provider call{wait.unmeteredProviderCalls === 1 ? " was" : "s were"} unmetered and counted as zero.
            </p>
          )
          : null}
        {waiting
          ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                data-session-budget-primary-action
                disabled={pendingDecision !== null}
                onClick={() => { setConfirmation("freshWindow"); }}
                size="sm"
              >
                {pendingDecision === "freshWindow"
                  ? "Continuing…"
                  : "Continue with fresh budget"}
              </Button>
              <Button
                disabled={pendingDecision !== null}
                onClick={() => { setConfirmation("stop"); }}
                size="sm"
                variant="ghost"
              >
                {pendingDecision === "stop" ? "Stopping…" : "Stop run"}
              </Button>
            </div>
          )
          : null}
      </div>
      <ConfirmDialog
        confirmLabel="Continue"
        confirmVariant="default"
        description="This keeps lifetime usage, advances both token baselines to the current totals, and resumes this same Run once."
        onConfirm={() => { void confirmDecision(); }}
        onOpenChange={open => { if (!open) { setConfirmation(null); } }}
        open={confirmation === "freshWindow"}
        title="Continue with a fresh budget?"
      />
      <ConfirmDialog
        confirmLabel="Stop run"
        description="This cancels only the active Run. Session usage, budget history, and the editable Thread are retained."
        onConfirm={() => { void confirmDecision(); }}
        onOpenChange={open => { if (!open) { setConfirmation(null); } }}
        open={confirmation === "stop"}
        title="Stop this run at the budget boundary?"
      />
    </>
  );
};

export const SessionBudgetCard = memo(SessionBudgetCardImpl);

function BudgetMetric({
  label,
  limit,
  value
}: {
  readonly label: string;
  readonly limit?: false | number;
  readonly value: number;
}) {
  return (
    <div className="bg-background/55 rounded-md px-2.5 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono tabular-nums">
        {formatSessionBudgetTokens(value)} / {typeof limit === "number"
          ? formatSessionBudgetTokens(limit)
          : "Unlimited"}
      </div>
    </div>
  );
}
