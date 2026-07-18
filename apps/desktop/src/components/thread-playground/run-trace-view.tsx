import { type RunSnapshot, usageForRun } from "@llm-space/core/thread";
import { ServerIcon } from "lucide-react";
import { memo } from "react";
import { format } from "timeago.js";

import { cn } from "@/lib/utils";
import { SnapshotMessageListView } from "./message/message-list-view";
import { TokenUsageSummary } from "./message/token-usage-summary";
import { StructuredOutputCard } from "./output/structured-output-card";
import {
  runMessageCountLabel,
  runModelLabel,
  summarizeRun
} from "./run-history-utils";

const _RunTraceView = function RunTraceView({
  className,
  run
}: {
  readonly className?: string;
  readonly run: RunSnapshot | null;
}) {
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
      <SnapshotMessageListView
        className="min-h-0 flex-1"
        context={run.thread.context}
        hideStructuredOutputs={Boolean(
          run.structuredOutput || run.structuredOutputFailure
        )}
        messages={messages}
      />
    </div>
  );
};

export const RunTraceView = memo(_RunTraceView);

function _shortId(value: string): string {
  return value.replace(/^(?:run|session)-/, "").slice(0, 8);
}
