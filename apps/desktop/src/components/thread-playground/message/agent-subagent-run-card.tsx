import { runtimeToolApprovalViews } from "@llm-space/runtime/harness";
import { BotIcon, ExternalLinkIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { decideToolApproval } from "@/client/tool-approval";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { SnapshotMessageListView } from "./message-list-view";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../ui/dialog";
import { formatCost } from "../token-usage";

import type {
  ExternalAgentProjectSubagentRun
} from "@/shared/external-agent-project";

const AgentSubagentRunCardImpl = function AgentSubagentRunCardImpl({
  run
}: {
  readonly run: ExternalAgentProjectSubagentRun;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="border-border/70 bg-background/45 flex flex-col gap-2 rounded-md border px-2.5 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <BotIcon className="text-muted-foreground size-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{run.subagentId}</div>
              <div className="text-muted-foreground truncate text-[10px]">
                {_statusLabel(run.status)}
              </div>
            </div>
          </div>
          <Button onClick={() => { setOpen(true); }} size="xs" variant="outline">
            Inspect child run
            <ExternalLinkIcon className="size-3" />
          </Button>
        </div>
        <p className="text-foreground/80 line-clamp-2 text-xs">{run.message}</p>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          <span>{run.model.provider}/{run.model.id}</span>
          <span>{_sandboxLabel(run)}</span>
          <span>{run.messages.length} messages</span>
        </div>
        {run.terminal?.error
          ? (
            <p className="text-destructive text-[10px]">
              {run.terminal.error.message}
            </p>
          )
          : null}
        {run.terminal?.result
          ? (
            <p className="text-muted-foreground line-clamp-3 border-t pt-2 text-[10px]">
              {run.terminal.result}
            </p>
          )
          : null}
      </div>
      <AgentSubagentRunInspector onOpenChange={setOpen} open={open} run={run} />
    </>
  );
};

export const AgentSubagentRunCard = memo(AgentSubagentRunCardImpl);

const AgentSubagentRunInspectorImpl = function AgentSubagentRunInspectorImpl({
  onOpenChange,
  open,
  run
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly run: ExternalAgentProjectSubagentRun;
}) {
  const usage = useMemo(() => _usage(run), [run]);
  const modelCalls = useMemo(() => _modelCalls(run), [run]);
  const childMessages = useMemo(() => [...run.messages], [run.messages]);
  const childContext = useMemo(() => ({
    messages: childMessages,
    systemPrompt: run.instructions,
    tools: []
  }), [childMessages, run.instructions]);
  const approvals = useMemo(
    () => runtimeToolApprovalViews(run.runtimeSession),
    [run.runtimeSession]
  );
  const pendingApproval = approvals.find(approval => approval.state === "pending");
  const [approvalConfirmation, setApprovalConfirmation] = useState<
    "approved" | "denied" | null
  >(null);
  const [deciding, setDeciding] = useState(false);
  const handleApproval = useCallback(async () => {
    const decision = approvalConfirmation;
    setApprovalConfirmation(null);
    if (!decision || !pendingApproval || deciding) { return; }
    setDeciding(true);
    try {
      await decideToolApproval(pendingApproval.id, decision);
      toast.success(decision === "approved"
        ? "Child tool approved"
        : "Child tool denied");
    } catch (error) {
      toast.error("Unable to decide child tool approval", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setDeciding(false);
    }
  }, [approvalConfirmation, deciding, pendingApproval]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(720px,calc(100vh-3rem))] w-[min(960px,calc(100vw-3rem))] max-w-none! flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <BotIcon className="size-4" />
            {run.subagentId}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-normal",
                run.status === "failed" || run.status === "outcomeUnknown"
                  ? "border-destructive/30 text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {_statusLabel(run.status)}
            </span>
          </DialogTitle>
          <DialogDescription>
            Child Session and Run are separate from the parent Thread.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-r p-3 text-xs">
            <InspectorSection label="Task">
              <p className="whitespace-pre-wrap">{run.message}</p>
            </InspectorSection>
            <InspectorSection label="Lineage">
              <Metadata label="Parent session" value={run.parent.sessionId} />
              <Metadata label="Parent run" value={run.parent.runId} />
              <Metadata label="Tool call" value={run.parent.toolCallId} />
              <Metadata label="Child session" value={run.child.sessionId} />
              <Metadata label="Child run" value={run.child.runId} />
              {run.retryOf
                ? <Metadata label="Retry of" value={run.retryOf.runId} />
                : null}
            </InspectorSection>
            <InspectorSection label="Execution">
              <Metadata
                label="Model"
                value={`${run.model.provider}/${run.model.id}`}
              />
              <Metadata label="Sandbox" value={_sandboxLabel(run)} />
              {run.sandbox.revalidationFingerprint
                ? (
                  <Metadata
                    label="Fingerprint"
                    value={run.sandbox.revalidationFingerprint}
                  />
                )
                : null}
              <Metadata
                label="Model calls"
                value={run.limits?.maxModelCallsPerRun === false
                  ? `${modelCalls} / unlimited`
                  : `${modelCalls} / ${run.limits?.maxModelCallsPerRun ?? 25}`}
              />
              <Metadata
                label="Tokens"
                value={`${usage.input} in · ${usage.output} out`}
              />
              <Metadata label="Cost" value={formatCost(usage.cost) ?? "$0"} />
            </InspectorSection>
            <InspectorSection label={`Capabilities · ${run.capabilities.length}`}>
              {run.capabilities.length > 0
                ? run.capabilities.map(capability => (
                  <div
                    className="border-border/70 rounded border px-2 py-1.5"
                    key={`${capability.kind}:${capability.sourcePath}`}
                  >
                    <div>{capability.name}</div>
                    <div className="text-muted-foreground truncate font-mono text-[10px]">
                      {capability.sourcePath}
                    </div>
                  </div>
                ))
                : <p className="text-muted-foreground">No authored capabilities</p>}
            </InspectorSection>
            {pendingApproval
              ? (
                <InspectorSection label="Waiting">
                  <p className="text-muted-foreground">
                    Child tool{" "}
                    <span className="text-foreground font-mono">
                      {pendingApproval.toolName}()
                    </span>{" "}
                    requires its own approval.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={deciding}
                      onClick={() => { setApprovalConfirmation("approved"); }}
                      size="xs"
                    >
                      Approve
                    </Button>
                    <Button
                      disabled={deciding}
                      onClick={() => { setApprovalConfirmation("denied"); }}
                      size="xs"
                      variant="outline"
                    >
                      Deny
                    </Button>
                  </div>
                </InspectorSection>
              )
              : null}
          </aside>
          <main className="flex min-h-0 min-w-0 flex-col">
            <details className="shrink-0 border-b px-3 py-2">
              <summary className="text-muted-foreground cursor-pointer text-[10px] font-medium">
                Child prompt
              </summary>
              <pre className="bg-background/70 mt-2 max-h-32 overflow-auto rounded-md border p-2 font-mono text-[10px] whitespace-pre-wrap">
                {run.instructions || "No instructions"}
              </pre>
            </details>
            <SnapshotMessageListView
              className="min-h-0 flex-1"
              context={childContext}
              messages={childMessages}
            />
          </main>
        </div>
      </DialogContent>
      <ConfirmDialog
        confirmLabel={approvalConfirmation === "approved" ? "Approve" : "Deny"}
        confirmVariant={approvalConfirmation === "approved"
          ? "default"
          : "destructive"}
        description={approvalConfirmation === "approved"
          ? "This approval may run the child tool and cause external side effects."
          : "This records the child tool call as not run."}
        onConfirm={() => { void handleApproval(); }}
        onOpenChange={next => {
          if (!next) { setApprovalConfirmation(null); }
        }}
        open={approvalConfirmation !== null}
        title={approvalConfirmation === "approved"
          ? "Approve this child tool call?"
          : "Deny this child tool call?"}
      />
    </Dialog>
  );
};

const AgentSubagentRunInspector = memo(AgentSubagentRunInspectorImpl);

function InspectorSection({
  children,
  label
}: {
  readonly children: React.ReactNode;
  readonly label: string;
}) {
  return (
    <section className="mb-4 flex flex-col gap-1.5">
      <h3 className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

function Metadata({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[10px]" title={value}>{value}</span>
    </div>
  );
}

function _sandboxLabel(run: ExternalAgentProjectSubagentRun): string {
  if (run.sandbox.mode === "shared") { return "Shared Sandbox"; }
  if (run.sandbox.mode === "isolated") { return "Isolated Sandbox"; }
  return "Direct";
}

function _statusLabel(
  status: ExternalAgentProjectSubagentRun["status"]
): string {
  const labels: Record<ExternalAgentProjectSubagentRun["status"], string> = {
    cancelled: "Cancelled",
    completed: "Completed",
    failed: "Failed",
    outcomeUnknown: "Outcome unknown",
    preparing: "Preparing",
    running: "Running",
    waitingForApproval: "Waiting for approval",
    waitingForBudget: "Waiting for budget",
    waitingForContinue: "Waiting to continue",
    waitingForToolResults: "Waiting for tool results"
  };
  return labels[status];
}

function _usage(run: ExternalAgentProjectSubagentRun): {
  readonly cost: number;
  readonly input: number;
  readonly output: number;
} {
  return run.messages.reduce((usage, message) => {
    if (message.role !== "assistant") { return usage; }
    return {
      cost: usage.cost + (message.usage?.cost.total ?? 0),
      input: usage.input + (message.usage?.input ?? 0),
      output: usage.output + (message.usage?.output ?? 0)
    };
  }, { cost: 0, input: 0, output: 0 });
}

function _modelCalls(run: ExternalAgentProjectSubagentRun): number {
  return run.runtimeSession.snapshot.operationLedger?.steps
    .flatMap(step => step.operations)
    .filter(operation =>
      operation.kind === "provider"
      && operation.providerSlot === undefined
      && operation.state !== "cancelled").length ?? 0;
}
