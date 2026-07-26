import { GaugeIcon } from "lucide-react";
import { memo, useMemo } from "react";

import type { AgentSessionLimitsDefinition } from "@llm-space/runtime";

import { cn } from "@/lib/utils";
import { modelCallLimitView } from "./model-call-limit-view";
import { useThreadStore } from "./stores";

const ModelCallLimitSummaryImpl = function ModelCallLimitSummaryImpl({
  limits
}: {
  readonly limits?: AgentSessionLimitsDefinition;
}) {
  const persisted = useThreadStore(state => state.thread.runtimeSession);
  const view = useMemo(
    () => modelCallLimitView(persisted, limits),
    [limits, persisted]
  );
  if (!view) { return null; }
  const label = `Model calls ${view.used}/${view.limit}`;
  return (
    <span
      aria-label={label}
      className={cn(
        "text-muted-foreground bg-foreground/4 flex h-5 min-w-0 items-center gap-1 rounded px-1.5 text-[0.5625rem]",
        view.reached && "bg-destructive/12 text-destructive"
      )}
    >
      <GaugeIcon className="size-3 shrink-0" />
      <span className="max-w-40 truncate font-mono tabular-nums">{label}</span>
    </span>
  );
};

export const ModelCallLimitSummary = memo(ModelCallLimitSummaryImpl);
