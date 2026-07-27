import { type RunSnapshot, usageForRun } from "@llm-space/core/thread";
import { ServerIcon } from "lucide-react";
import { memo } from "react";
import { format } from "timeago.js";

import { cn } from "@/lib/utils";
import { useAgentSubagentRunsForParentRun } from "./agent-subagent-runs-context";
import { AgentSubagentRunCard } from "./message/agent-subagent-run-card";
import { SnapshotMessageListView } from "./message/message-list-view";
import { TokenUsageSummary } from "./message/token-usage-summary";
import { StructuredOutputCard } from "./output/structured-output-card";
import {
  runMessageCountLabel,
  runModelLabel,
  runRuntimeProfileLabel,
  summarizeRun
} from "./run-history-utils";
import { formatCost } from "./token-usage";

const _RunTraceView = function RunTraceView({
  className,
  run
}: {
  readonly className?: string;
  readonly run: RunSnapshot | null;
}) {
  const subagentRuns = useAgentSubagentRunsForParentRun(run?.runtime?.runId);
  if (!run) {
    return (
      <div className="text-muted-foreground px-4 py-8 text-center text-xs">
        Select a saved run to inspect.
      </div>
    );
  }

  const messages = run.thread.context?.messages ?? [];
  const usage = usageForRun(run);
  const systemPrompt =
    run.thread.context?.systemPrompt?.trim() || "No system prompt";
  const server = run.runtime?.server;
  const runtimeProfileLabel = runRuntimeProfileLabel(run.runtime);
  const modelCallLimit = run.runLimitFailure;
  const childUsage = subagentRuns.reduce((total, child) => {
    total.modelCalls += child.runtimeSession.snapshot.operationLedger?.steps
      .flatMap(step => step.operations)
      .filter(operation =>
        operation.kind === "provider"
        && operation.providerSlot === undefined
        && operation.state !== "cancelled").length ?? 0;
    for (const message of child.messages) {
      if (message.role !== "assistant") { continue; }
      total.cost += message.usage?.cost.total ?? 0;
      total.input += message.usage?.input ?? 0;
      total.output += message.usage?.output ?? 0;
    }
    return total;
  }, { cost: 0, input: 0, modelCalls: 0, output: 0 });
  const childCost = formatCost(childUsage.cost);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="shrink-0 border-b px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="line-clamp-2 min-w-0 font-mono text-xs">
            {summarizeRun(run.thread)}
          </div>
          <div className="text-muted-foreground shrink-0 text-[0.625rem]">
            {format(run.timestamp)}
          </div>
        </div>
        <div className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem]">
          <span>{runModelLabel(run.thread)}</span>
          {runtimeProfileLabel ? <span>{runtimeProfileLabel}</span> : null}
          {run.thread.agentRuntime
            ? (
              <span>
                {run.thread.agentRuntime.modelSource === "agent"
                  ? "From Agent"
                  : "Thread override"}
              </span>
            )
            : null}
          <span>{runMessageCountLabel(run.thread)}</span>
          <span>{new Date(run.timestamp).toLocaleString()}</span>
        </div>
        {server
          ? (
            <div
              aria-label="Local Server run lineage"
              className="text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5 font-mono text-[0.625rem]"
            >
              <span className="text-foreground flex items-center gap-1 font-sans font-medium">
                <ServerIcon className="size-3" /> Local Server
              </span>
              <span title={server.artifactFingerprint}>
                artifact {_shortId(server.artifactFingerprint)}
              </span>
              <span title={server.sessionId}>
                session {_shortId(server.sessionId)}
              </span>
              <span title={server.runId}>run {_shortId(server.runId)}</span>
            </div>
          )
          : null}
        {usage ? <TokenUsageSummary className="mt-2" usage={usage} /> : null}
        {subagentRuns.length > 0
          ? (
            <div className="text-muted-foreground mt-2 text-[0.625rem]">
              Delegation · {subagentRuns.length} child{subagentRuns.length === 1
                ? ""
                : "ren"} · {childUsage.modelCalls.toLocaleString()} model calls ·{" "}
              {childUsage.input.toLocaleString()} in ·{" "}
              {childUsage.output.toLocaleString()} out
              {childCost ? ` · ${childCost}` : null}
            </div>
          )
          : null}
        {modelCallLimit
          ? (
            <div className="border-destructive/30 bg-destructive/8 text-destructive mt-2 rounded-md border px-2 py-1.5 text-[0.625rem]">
              Model limit reached · {modelCallLimit.consumed}/{modelCallLimit.limit}
            </div>
          )
          : null}
        {run.structuredOutput || run.structuredOutputFailure
          ? (
            <StructuredOutputCard
              className="mt-2"
              failure={run.structuredOutputFailure}
              result={run.structuredOutput}
            />
          )
          : null}
      </div>
      <details className="group shrink-0 border-b px-3 py-2">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[0.625rem] font-medium">
          System Prompt
        </summary>
        <pre
          className={cn(
            "bg-background/70 mt-2 max-h-36 overflow-auto rounded-md border px-2 py-2",
            "font-mono text-[0.6875rem] leading-relaxed break-words whitespace-pre-wrap"
          )}
        >
          {systemPrompt}
        </pre>
      </details>
      {subagentRuns.length > 0
        ? (
          <section className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
            <div className="text-muted-foreground text-[0.625rem] font-medium">
              Child runs
            </div>
            {subagentRuns.map(child => (
              <AgentSubagentRunCard key={child.child.runId} run={child} />
            ))}
          </section>
        )
        : null}
      <SnapshotMessageListView
        className="min-h-0 flex-1"
        context={run.thread.context}
        hideStructuredOutputs={Boolean(
          run.structuredOutput || run.structuredOutputFailure
        )}
        messages={messages}
        sandboxAttachments={run.thread.sandboxAttachments}
      />
    </div>
  );
};

export const RunTraceView = memo(_RunTraceView);

function _shortId(value: string): string {
  return value.replace(/^(?:run|session)-/, "").slice(0, 8);
}
