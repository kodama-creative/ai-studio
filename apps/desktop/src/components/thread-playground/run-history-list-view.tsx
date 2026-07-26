import { convertFromPiMessages, type Thread } from "@llm-space/core";
import {
  type RuntimeBranchSnapshot,
  type RuntimeCompactionSnapshot,
  runtimeHistoryMessages,
  type RuntimeRunFailure,
  type RuntimeSessionBudgetWaitSnapshot,
  runtimeToolApprovalViews,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EyeIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  Minimize2Icon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon
} from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { format } from "timeago.js";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ThreadRuntimeRunState } from "@llm-space/core";
import type {
  EvaluationRecord,
  RunSnapshot
} from "@llm-space/core/thread";

import { cn } from "@/lib/utils";
import { RunEvaluationDialog } from "./run-evaluation-dialog";
import {
  averageScoreForRun,
  evaluationScoreDelta,
  findEvaluationForPair,
  preferredEvaluationRubricId
} from "./run-evaluation-utils";
import {
  groupRuntimeRunCheckpoints,
  runMessageCountLabel,
  runModelLabel,
  runRuntimeProfileLabel,
  summarizeRun
} from "./run-history-utils";
import { RunTraceView } from "./run-trace-view";
import {
  runtimeRunStates,
  useThreadStore,
  useThreadStoreActions
} from "./stores";
import { useAutoAnimation } from "../../lib/use-auto-animation";
import { ConfirmDialog } from "../confirm-dialog";
import { Tooltip } from "../tooltip";
import { Button } from "../ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup } from "../ui/item";

const VERDICT_LABELS: Record<EvaluationRecord["verdict"], string> = {
  leftBetter: "Run A Better",
  rightBetter: "Run B Better",
  tie: "Tie",
  pass: "Pass",
  fail: "Fail"
};

const RUNTIME_STATE_LABELS: Record<ThreadRuntimeRunState, string> = {
  runningModel: "Running model",
  runningTools: "Running tools",
  waitingForApproval: "Waiting for approval",
  waitingForBudget: "Waiting for budget",
  waitingForToolResults: "Waiting for tool results",
  waitingForContinue: "Waiting to continue",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  superseded: "Superseded",
  outcomeUnknown: "Outcome unknown"
};

const _RunHistoryListView = function RunHistoryListView({
  compactNowAvailable,
  inspectRunRequest,
  onClose
}: {
  readonly compactNowAvailable: boolean;
  readonly inspectRunRequest?: { revision: number; runId: string; };
  readonly onClose: () => void;
}) {
  const [containerRef] = useAutoAnimation();
  const runHistory = useThreadStore(s => s.runHistory);
  const status = useThreadStore(s => s.status);
  const thread = useThreadStore(s => s.thread);
  const evaluations = useThreadStore(s => s.evaluations);
  const evaluationRubrics = useThreadStore(s => s.evaluationRubrics);
  const persistedRuntimeSession = useThreadStore(s => s.thread.runtimeSession);
  const {
    compactNow,
    restoreThread,
    restoreRuntimeCheckpoint,
    renameRuntimeBranch,
    removeRun,
    saveEvaluation,
    removeEvaluation,
    saveEvaluationRubric,
    removeEvaluationRubric
  } = useThreadStoreActions();
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [evaluationOpen, setEvaluationOpen] = useState(false);
  const [inspectingRunId, setInspectingRunId] = useState<string | null>(null);
  const [inspectingCompactionId, setInspectingCompactionId] =
    useState<string | null>(null);
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(
    () => new Set()
  );
  const [runPendingRemoval, setRunPendingRemoval] =
    useState<RunSnapshot | null>(null);
  const [evaluationPendingRemoval, setEvaluationPendingRemoval] =
    useState<EvaluationRecord | null>(null);
  const [compactionRetryOpen, setCompactionRetryOpen] = useState(false);
  const handleCompactNow = useCallback(() => {
    void compactNow().then(result => {
      if (result === "confirmationRequired") {
        setCompactionRetryOpen(true);
      }
    });
  }, [compactNow]);
  const runs = useMemo(() => runHistory.slice().reverse(), [runHistory]);
  const runtimeTree = useMemo(() => _runtimeTree(
    persistedRuntimeSession,
    runHistory,
    thread
  ), [persistedRuntimeSession, runHistory, thread]);
  const inspectionRuns = runtimeTree?.inspectionRuns ?? runs;
  const currentRuntimeRunStates = useMemo(
    () => runtimeRunStates(persistedRuntimeSession),
    [persistedRuntimeSession]
  );
  const pendingApprovalCounts = useMemo(() => {
    const session = persistedRuntimeSession as StoredRuntimeSession | undefined;
    const counts = new Map<string, number>();
    if (!session?.snapshot) { return counts; }
    for (const approval of runtimeToolApprovalViews(session)) {
      if (approval.state !== "pending") { continue; }
      counts.set(approval.runId, (counts.get(approval.runId) ?? 0) + 1);
    }
    return counts;
  }, [persistedRuntimeSession]);
  const reviewApprovals = useCallback(() => {
    onClose();
    queueMicrotask(() => {
      const session = persistedRuntimeSession as StoredRuntimeSession | undefined;
      if (!session?.snapshot.id) { return; }
      const target = document.querySelector<HTMLElement>(
        `[data-runtime-session-id="${CSS.escape(session.snapshot.id)}"]`
        + '[data-tool-approval-state="pending"]'
      );
      target?.focus({ preventScroll: false });
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [onClose, persistedRuntimeSession]);
  const runGroups = useMemo(
    () => groupRuntimeRunCheckpoints(runs, currentRuntimeRunStates),
    [currentRuntimeRunStates, runs]
  );
  const inspectingRunIndex = useMemo(() => {
    if (!inspectingRunId) {
      return -1;
    }
    return inspectionRuns.findIndex(run => run.id === inspectingRunId);
  }, [inspectingRunId, inspectionRuns]);
  const inspectingRun =
    inspectingRunIndex >= 0 ? inspectionRuns[inspectingRunIndex] : null;
  const inspectingCompaction = runtimeTree?.compactions.find(
    compaction => compaction.id === inspectingCompactionId
  ) ?? null;
  const canInspectPrevious = inspectingRunIndex > 0;
  const canInspectNext =
    inspectingRunIndex >= 0
    && inspectingRunIndex < inspectionRuns.length - 1;
  const runById = useMemo(() => {
    return new Map(runHistory.map(run => [run.id, run]));
  }, [runHistory]);
  const selectedRuns = useMemo(() => {
    return selectedRunIds
      .map(id => runById.get(id))
      .filter((run): run is RunSnapshot => Boolean(run));
  }, [runById, selectedRunIds]);
  const comparisonRuns = useMemo(
    () => (selectedRuns.length === 2
      ? [selectedRuns[0], selectedRuns[1]] as const
      : null),
    [selectedRuns]
  );
  const selectedEvaluation = useMemo(() => {
    if (!comparisonRuns) {
      return null;
    }
    return findEvaluationForPair(
      evaluations,
      comparisonRuns[0].id,
      comparisonRuns[1].id
    );
  }, [comparisonRuns, evaluations]);
  const preferredRubricId = useMemo(
    () => preferredEvaluationRubricId(evaluations, evaluationRubrics),
    [evaluationRubrics, evaluations]
  );

  useEffect(() => {
    setSelectedRunIds(current => current.filter(id => runById.has(id)));
  }, [runById]);
  useEffect(() => {
    if (inspectingRunId && inspectingRunIndex === -1) {
      setInspectingRunId(null);
    }
  }, [inspectingRunId, inspectingRunIndex]);
  useEffect(() => {
    if (inspectRunRequest && runById.has(inspectRunRequest.runId)) {
      setInspectingRunId(inspectRunRequest.runId);
    }
  }, [inspectRunRequest, runById]);

  const toggleRunSelection = useCallback((runId: string) => {
    setSelectedRunIds(current => {
      if (current.includes(runId)) {
        return current.filter(id => id !== runId);
      }
      if (current.length >= 2) {
        return [current[1], runId];
      }
      return [...current, runId];
    });
  }, []);

  const openEvaluation = useCallback(
    (leftRunId: string, rightRunId: string) => {
      setSelectedRunIds([leftRunId, rightRunId]);
      setEvaluationOpen(true);
    },
    []
  );

  const handleCompareSelected = useCallback(() => {
    if (comparisonRuns) {
      setEvaluationOpen(true);
    }
  }, [comparisonRuns]);
  const handleRestoreRun = useCallback(
    (run: RunSnapshot) => {
      if (
        run.runtime?.branchId
        && run.runtime.checkpointId
        && restoreRuntimeCheckpoint(
          run.runtime.branchId,
          run.runtime.checkpointId,
          run.thread
        )
      ) {
        return;
      }
      restoreThread(run.thread);
    },
    [restoreRuntimeCheckpoint, restoreThread]
  );
  const inspectRunFromHistory = useCallback((run: RunSnapshot) => {
    setInspectingCompactionId(null);
    setInspectingRunId(run.id);
  }, []);
  const inspectCompactionFromHistory = useCallback((id: string) => {
    setInspectingRunId(null);
    setInspectingCompactionId(id);
  }, []);
  const handleBackToHistory = useCallback(() => {
    setInspectingRunId(null);
    setInspectingCompactionId(null);
  }, []);
  useEffect(() => {
    if (!inspectingRunId && !inspectingCompactionId) { return; }
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") { return; }
      event.preventDefault();
      handleBackToHistory();
    };
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("keydown", handleEscape); };
  }, [handleBackToHistory, inspectingCompactionId, inspectingRunId]);
  const toggleBranch = useCallback((branchId: string) => {
    setCollapsedBranchIds(current => {
      const next = new Set(current);
      if (next.has(branchId)) {
        next.delete(branchId);
      } else {
        next.add(branchId);
      }
      return next;
    });
  }, []);
  const inspectPreviousRun = useCallback(() => {
    if (canInspectPrevious) {
      setInspectingRunId(inspectionRuns[inspectingRunIndex - 1].id);
    }
  }, [canInspectPrevious, inspectingRunIndex, inspectionRuns]);
  const inspectNextRun = useCallback(() => {
    if (canInspectNext) {
      setInspectingRunId(inspectionRuns[inspectingRunIndex + 1].id);
    }
  }, [canInspectNext, inspectingRunIndex, inspectionRuns]);
  const handleTreeNavigation = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!runtimeTree || event.target instanceof HTMLInputElement) { return; }
      if (
        event.key !== "ArrowUp"
        && event.key !== "ArrowDown"
        && event.key !== "ArrowLeft"
        && event.key !== "ArrowRight"
      ) {
        return;
      }
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-runtime-tree-node]"
      );
      if (!target) { return; }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>(
          "[data-runtime-tree-node]"
        )].filter(node => node.offsetParent !== null);
        const index = nodes.indexOf(target);
        const next = nodes[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) {
          event.preventDefault();
          next.focus();
        }
        return;
      }
      const section = target.closest<HTMLElement>(
        "section[data-runtime-branch-section]"
      );
      const branchNode = section?.querySelector<HTMLElement>(
        "[data-runtime-branch-node]"
      );
      if (event.key === "ArrowLeft" && branchNode && target !== branchNode) {
        event.preventDefault();
        event.stopPropagation();
        branchNode.focus();
      } else if (
        event.key === "ArrowRight"
        && branchNode
        && target === branchNode
      ) {
        const firstChild = [
          ...(section?.querySelectorAll<HTMLElement>(
            "[data-runtime-tree-node]"
          ) ?? [])
        ].find(node => node !== branchNode && node.offsetParent !== null);
        if (firstChild) {
          event.preventDefault();
          event.stopPropagation();
          firstChild.focus();
        }
      }
    },
    [runtimeTree]
  );

  if (inspectingCompaction) {
    return (
      <div className="flex size-full flex-col">
        <div className="text-muted-foreground flex h-12 shrink-0 items-center gap-1 border-b px-2 text-sm">
          <Button
            aria-label="Back to run history"
            onClick={handleBackToHistory}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-3" />
            Back
          </Button>
          <div className="min-w-0 flex-1 px-1">
            <div className="text-foreground truncate text-sm">
              Context compacted
            </div>
            <div className="text-muted-foreground truncate text-[0.625rem]">
              {inspectingCompaction.model.provider} / {inspectingCompaction.model.id}
            </div>
          </div>
          <Tooltip content="Copy summary">
            <Button
              aria-label="Copy compaction summary"
              onClick={() => {
                void navigator.clipboard.writeText(
                  inspectingCompaction.summary
                );
              }}
              size="icon-sm"
              variant="ghost"
            >
              <CopyIcon className="size-3" />
            </Button>
          </Tooltip>
          <Button
            aria-label="Close run history"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.6875rem]">
            <dt className="text-muted-foreground">Before</dt>
            <dd className="text-right tabular-nums">
              {inspectingCompaction.tokenEvidence.tokensBefore.toLocaleString()} tokens
            </dd>
            <dt className="text-muted-foreground">After</dt>
            <dd className="text-right tabular-nums">
              {inspectingCompaction.tokenEvidence.tokensAfter.toLocaleString()} tokens
            </dd>
            <dt className="text-muted-foreground">Provider usage</dt>
            <dd className="text-right tabular-nums">
              {inspectingCompaction.tokenEvidence.usageTokens.toLocaleString()}
            </dd>
            <dt className="text-muted-foreground">Trailing estimate</dt>
            <dd className="text-right tabular-nums">
              {inspectingCompaction.tokenEvidence.trailingTokens.toLocaleString()}
            </dd>
            <dt className="text-muted-foreground">Covered through</dt>
            <dd
              className="truncate text-right font-mono"
              title={inspectingCompaction.sourceHeadEntryId}
            >
              {inspectingCompaction.sourceHeadEntryId}
            </dd>
            <dt className="text-muted-foreground">Retained from</dt>
            <dd
              className="truncate text-right font-mono"
              title={inspectingCompaction.firstKeptEntryId}
            >
              {inspectingCompaction.firstKeptEntryId}
            </dd>
          </dl>
          <div className="mt-4 text-xs font-medium">Summary</div>
          <pre className="bg-muted/50 mt-2 whitespace-pre-wrap rounded-md border p-3 font-mono text-[0.6875rem] leading-relaxed">
            {inspectingCompaction.summary}
          </pre>
        </div>
      </div>
    );
  }

  if (inspectingRun) {
    return (
      <div className="flex size-full flex-col">
        <div className="text-muted-foreground flex h-12 shrink-0 items-center gap-1 border-b px-2 text-sm">
          <Button
            aria-label="Back to run history"
            onClick={handleBackToHistory}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-3" />
            Back
          </Button>
          <div className="min-w-0 flex-1 px-1">
            <div className="text-foreground truncate text-sm">Inspect Run</div>
            <div className="text-muted-foreground text-[0.625rem]">
              {inspectingRunIndex + 1} of {inspectionRuns.length}
            </div>
          </div>
          <Tooltip content="Previous run">
            <Button
              aria-label="Inspect previous run"
              disabled={!canInspectPrevious}
              onClick={inspectPreviousRun}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeftIcon className="size-3" />
            </Button>
          </Tooltip>
          <Tooltip content="Next run">
            <Button
              aria-label="Inspect next run"
              disabled={!canInspectNext}
              onClick={inspectNextRun}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRightIcon className="size-3" />
            </Button>
          </Tooltip>
          <Button
            aria-label="Close run history"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
        <RunTraceView className="min-h-0 flex-1" run={inspectingRun} />
      </div>
    );
  }

  return (
    <div className="flex size-full flex-col">
      <div className="text-muted-foreground flex h-12 shrink-0 items-center justify-between border-b pl-3 text-sm">
        <div>Run history</div>
        <div className="pr-2">
          <Button
            aria-label="Close run history"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      </div>
      <div className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Compare Runs</div>
            <div className="text-muted-foreground text-[0.625rem]">
              {selectedRuns.length}/2 selected
            </div>
          </div>
          <Button
            disabled={!comparisonRuns}
            onClick={handleCompareSelected}
            size="sm"
          >
            <GitCompareArrowsIcon className="size-3" />
            Compare
          </Button>
        </div>
      </div>
      <div
        className="min-h-0 grow overflow-y-auto px-3 py-3.5"
        onKeyDownCapture={handleTreeNavigation}
        ref={containerRef}
      >
        <div className="flex flex-col gap-3.5">
          {runtimeTree
            ? runtimeTree.branches.map(branch => (
              <RuntimeBranchSection
                branch={branch}
                collapsed={collapsedBranchIds.has(branch.branch.id)}
                currentCheckpointId={runtimeTree.currentCheckpointId}
                key={branch.branch.id}
                onCompactNow={compactNowAvailable && status === "idle"
                  ? handleCompactNow
                  : undefined}
                onInspectCompaction={inspectCompactionFromHistory}
                onInspectRun={inspectRunFromHistory}
                onRenameBranch={renameRuntimeBranch}
                onRequestRemove={setRunPendingRemoval}
                onRestore={handleRestoreRun}
                onReviewApprovals={reviewApprovals}
                onToggleBranch={toggleBranch}
                onToggleSelected={toggleRunSelection}
                pendingApprovalCounts={pendingApprovalCounts}
                selectedRunIds={selectedRunIds}
                workingBase={thread.runtimeWorkingBase}
              />
            ))
            : runs.length === 0
              ? (
                <div className="text-muted-foreground m-auto text-xs">
                  No runs yet
                </div>
              )
              : (
                runGroups.map(group => (
                  <section
                    aria-label={group.runtimeRunId
                      ? `Runtime Run ${group.runtimeRunId}`
                      : "Legacy run checkpoint"}
                    className="flex flex-col gap-2"
                    key={group.id}
                  >
                    {group.runtimeRunId && group.state
                      ? (
                        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-1 text-[0.625rem]">
                          <GitBranchIcon className="size-3 shrink-0" />
                          <span
                            className="text-foreground/80 truncate font-medium"
                            title={group.runtimeRunId}
                          >
                            Run {group.runtimeRunId.replace(/^run-/, "").slice(0, 8)}
                          </span>
                          <span aria-hidden>·</span>
                          <span className="truncate">
                            {group.state === "waitingForApproval"
                              ? `Waiting for approval · ${pendingApprovalCounts.get(group.runtimeRunId) ?? 0} pending`
                              : RUNTIME_STATE_LABELS[group.state]}
                          </span>
                          {group.state === "waitingForApproval"
                            ? (
                              <Button
                                className="ml-auto h-5 px-1.5 text-[10px]"
                                onClick={reviewApprovals}
                                size="sm"
                                variant="ghost"
                              >
                                Review
                              </Button>
                            )
                            : null}
                          <span className="ml-auto shrink-0 tabular-nums">
                            {group.runs.length} {group.runs.length === 1
                              ? "checkpoint"
                              : "checkpoints"}
                          </span>
                        </div>
                      )
                      : null}
                    <ItemGroup className="gap-2!">
                      {group.runs.map(run => (
                        <RunHistoryItem
                          key={run.id}
                          newest={run.id === runs[0]?.id}
                          onInspectRun={inspectRunFromHistory}
                          onRequestRemove={setRunPendingRemoval}
                          onRestore={handleRestoreRun}
                          onToggleSelected={toggleRunSelection}
                          run={run}
                          selected={selectedRunIds.includes(run.id)}
                        />
                      ))}
                    </ItemGroup>
                  </section>
                ))
              )}
        </div>
        {evaluations.length > 0 && (
          <_EvaluationList
            evaluations={evaluations}
            onOpenEvaluation={openEvaluation}
            onRequestRemove={setEvaluationPendingRemoval}
            runById={runById}
          />
        )}
      </div>
      <RunEvaluationDialog
        evaluation={selectedEvaluation}
        leftRun={comparisonRuns?.[0] ?? null}
        onOpenChange={setEvaluationOpen}
        onRemoveRubric={removeEvaluationRubric}
        onSave={saveEvaluation}
        onSaveRubric={saveEvaluationRubric}
        open={evaluationOpen}
        preferredRubricId={preferredRubricId}
        rightRun={comparisonRuns?.[1] ?? null}
        rubrics={evaluationRubrics}
      />
      <ConfirmDialog
        confirmLabel="Retry compaction"
        confirmVariant="default"
        description="The previous summary request may have reached the model, but its result could not be confirmed. Retrying starts a new provider operation and may incur the summary cost again."
        onConfirm={() => {
          setCompactionRetryOpen(false);
          void compactNow(true);
        }}
        onOpenChange={setCompactionRetryOpen}
        open={compactionRetryOpen}
        title="Retry context compaction?"
      />
      <ConfirmDialog
        confirmLabel="Remove"
        description="This removes the saved run from this thread and removes any evaluations that reference it."
        onConfirm={() => {
          const run = runPendingRemoval;
          setRunPendingRemoval(null);
          if (run) {
            removeRun(run);
          }
        }}
        onOpenChange={open => {
          if (!open) {
            setRunPendingRemoval(null);
          }
        }}
        open={runPendingRemoval !== null}
        title="Remove Run?"
      />
      <ConfirmDialog
        confirmLabel="Remove"
        description="This removes the saved evaluation from this thread. The compared runs are kept."
        onConfirm={() => {
          const evaluation = evaluationPendingRemoval;
          setEvaluationPendingRemoval(null);
          if (evaluation) {
            removeEvaluation(evaluation);
          }
        }}
        onOpenChange={open => {
          if (!open) {
            setEvaluationPendingRemoval(null);
          }
        }}
        open={evaluationPendingRemoval !== null}
        title="Remove Evaluation?"
      />
    </div>
  );
};

export const RunHistoryListView = memo(_RunHistoryListView);

interface RuntimeCheckpointView {
  readonly run: RunSnapshot;
  readonly saved: boolean;
}

interface RuntimeRunView {
  readonly budgetWaits: readonly RuntimeSessionBudgetWaitSnapshot[];
  readonly checkpoints: readonly RuntimeCheckpointView[];
  readonly compactions: readonly RuntimeCompactionSnapshot[];
  readonly id: string;
  readonly failure?: RuntimeRunFailure;
  readonly state: ThreadRuntimeRunState;
}

interface RuntimeBranchView {
  readonly branch: RuntimeBranchSnapshot;
  readonly runs: readonly RuntimeRunView[];
}

interface RuntimeTreeView {
  readonly branches: readonly RuntimeBranchView[];
  readonly compactions: readonly RuntimeCompactionSnapshot[];
  readonly currentCheckpointId: string | null;
  readonly inspectionRuns: readonly RunSnapshot[];
}

function _runtimeTree(
  persisted: unknown,
  savedRuns: readonly RunSnapshot[],
  thread: Thread
): RuntimeTreeView | null {
  try {
    const session = persisted as StoredRuntimeSession | undefined;
    if (session?.snapshot.schemaVersion !== 6) { return null; }
    const history = session.snapshot.history;
    const savedByCheckpoint = new Map(
      savedRuns.flatMap(run => (run.runtime?.checkpointId
        ? [[run.runtime.checkpointId, run] as const]
        : []))
    );
    const configurations = new Map(
      session.configurations.map(configuration => [
        configuration.id,
        configuration
      ])
    );
    const checkpointsByRun = new Map<string, RuntimeCheckpointView[]>();
    for (const checkpoint of history.checkpoints) {
      const saved = savedByCheckpoint.get(checkpoint.id);
      const runtimeRun = session.snapshot.runs.find(
        run => run.id === checkpoint.runId
      );
      const configuration = runtimeRun
        ? configurations.get(runtimeRun.configurationId)
        : undefined;
      if (!runtimeRun || !configuration) { continue; }
      const run = saved ?? _syntheticRunSnapshot(
        thread,
        session,
        checkpoint,
        configuration.model
      );
      const views = checkpointsByRun.get(checkpoint.runId) ?? [];
      views.push({ run, saved: Boolean(saved) });
      checkpointsByRun.set(checkpoint.runId, views);
    }
    const compactionsByRun = new Map<string, RuntimeCompactionSnapshot[]>();
    for (const compaction of history.compactions) {
      const items = compactionsByRun.get(compaction.runId) ?? [];
      items.push(compaction);
      compactionsByRun.set(compaction.runId, items);
    }
    const branches = history.branches.map(branch => ({
      branch,
      runs: session.snapshot.runs
        .filter(run => run.branchId === branch.id)
        .map(run => ({
          id: run.id,
          ...(run.failure ? { failure: run.failure } : {}),
          state: run.state,
          budgetWaits: session.snapshot.budget?.waits.filter(
            wait => wait.runId === run.id
          ) ?? [],
          checkpoints: checkpointsByRun.get(run.id) ?? [],
          compactions: compactionsByRun.get(run.id) ?? []
        }))
    }));
    return {
      branches,
      compactions: history.compactions,
      currentCheckpointId: history.currentCheckpointId,
      inspectionRuns: branches.flatMap(branch =>
        branch.runs.flatMap(run => run.checkpoints.map(item => item.run)))
    };
  } catch {
    return null;
  }
}

function _syntheticRunSnapshot(
  thread: Thread,
  session: StoredRuntimeSession,
  checkpoint: StoredRuntimeSession["snapshot"]["history"]["checkpoints"][number],
  model: { readonly id: string; readonly provider: string; }
): RunSnapshot {
  const piMessages = runtimeHistoryMessages(
    session.snapshot.history,
    checkpoint.headEntryId
  ) as unknown as AgentMessage[];
  const messages = convertFromPiMessages(
    piMessages,
    thread.context?.messages ?? [],
    thread.sandboxAttachments
  );
  const sameModel = thread.model?.provider === model.provider
    && thread.model.id === model.id;
  return {
    id: `runtime:${checkpoint.id}`,
    timestamp: checkpoint.createdAt,
    thread: {
      ...(thread.title ? { title: thread.title } : {}),
      model: {
        provider: model.provider,
        id: model.id,
        ...(sameModel && thread.model?.params
          ? { params: thread.model.params }
          : {})
      },
      ...(thread.outputContract
        ? { outputContract: thread.outputContract }
        : {}),
      ...(thread.agentRuntime ? { agentRuntime: thread.agentRuntime } : {}),
      ...(thread.sandboxAttachments
        ? { sandboxAttachments: thread.sandboxAttachments }
        : {}),
      ...(thread.lockedSandboxAttachmentMessageIds
        ? {
          lockedSandboxAttachmentMessageIds:
            thread.lockedSandboxAttachmentMessageIds
        }
        : {}),
      context: { ...thread.context, messages }
    },
    runtime: {
      runId: checkpoint.runId,
      branchId: checkpoint.branchId,
      checkpointId: checkpoint.id,
      state: checkpoint.state,
      checkpointOrder: session.snapshot.history.checkpoints
        .filter(item => item.runId === checkpoint.runId)
        .findIndex(item => item.id === checkpoint.id) + 1,
      continuationFingerprint: checkpoint.continuationFingerprint
    }
  };
}

const RuntimeBudgetBoundaryItem = memo(({
  wait
}: {
  readonly wait: RuntimeSessionBudgetWaitSnapshot;
}) => {
  const status = wait.status === "waiting"
    ? "Decision required"
    : wait.status === "granted"
      ? "Fresh budget granted"
      : "Run stopped";
  const reached = wait.reached.join(" + ");
  return (
    <div className="border-amber-500/25 bg-amber-500/6 flex flex-col gap-1 rounded-md border px-2.5 py-2 text-[0.625rem]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground/85 font-medium">
          Session budget · {status}
        </span>
        <span className="text-muted-foreground capitalize">{reached}</span>
      </div>
      <div className="text-muted-foreground font-mono tabular-nums">
        Window {_compactTokens(wait.window.input)} input · {_compactTokens(wait.window.output)} output
      </div>
      <div className="text-muted-foreground font-mono tabular-nums">
        Lifetime {_compactTokens(wait.lifetime.input)} input · {_compactTokens(wait.lifetime.output)} output
      </div>
      <div className="text-muted-foreground font-mono tabular-nums">
        Baseline {_compactTokens(wait.baseline.input)} input · {_compactTokens(wait.baseline.output)} output
        {wait.unmeteredProviderCalls > 0
          ? ` · ${wait.unmeteredProviderCalls} unmetered`
          : ""}
      </div>
    </div>
  );
});

function _compactTokens(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value).toLowerCase();
}

const RuntimeBranchSection = memo(({
  branch,
  collapsed,
  currentCheckpointId,
  onCompactNow,
  onInspectCompaction,
  onInspectRun,
  onRenameBranch,
  onRequestRemove,
  onRestore,
  onReviewApprovals,
  onToggleBranch,
  onToggleSelected,
  pendingApprovalCounts,
  selectedRunIds,
  workingBase
}: {
  readonly branch: RuntimeBranchView;
  readonly collapsed: boolean;
  readonly currentCheckpointId: string | null;
  readonly onCompactNow?: () => void;
  readonly onInspectCompaction: (id: string) => void;
  readonly onInspectRun: (run: RunSnapshot) => void;
  readonly onRenameBranch: (branchId: string, label: string) => Promise<boolean>;
  readonly onRequestRemove: (run: RunSnapshot) => void;
  readonly onRestore: (run: RunSnapshot) => void;
  readonly onReviewApprovals: () => void;
  readonly onToggleBranch: (branchId: string) => void;
  readonly onToggleSelected: (runId: string) => void;
  readonly pendingApprovalCounts: ReadonlyMap<string, number>;
  readonly selectedRunIds: readonly string[];
  readonly workingBase: Thread["runtimeWorkingBase"];
}) => {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(branch.branch.label);
  useEffect(() => { setLabel(branch.branch.label); }, [branch.branch.label]);
  const beginRename = useCallback(() => {
    setLabel(branch.branch.label);
    setEditing(true);
  }, [branch.branch.label]);
  const submitRename = useCallback(async () => {
    if (await onRenameBranch(branch.branch.id, label)) {
      setEditing(false);
    }
  }, [branch.branch.id, label, onRenameBranch]);
  return (
    <section
      aria-label={`Branch ${branch.branch.label}`}
      className="flex flex-col gap-2"
      data-runtime-branch-section
    >
      <div
        className="group/branch focus-visible:ring-ring flex min-w-0 items-center rounded px-0.5 text-xs focus-visible:ring-2"
        data-runtime-branch-node
        data-runtime-tree-node
        onKeyDown={event => {
          if (event.key === "F2") {
            event.preventDefault();
            beginRename();
          } else if (event.key === "ArrowLeft" && !collapsed) {
            event.preventDefault();
            onToggleBranch(branch.branch.id);
          } else if (event.key === "ArrowRight" && collapsed) {
            event.preventDefault();
            onToggleBranch(branch.branch.id);
          }
        }}
        tabIndex={0}
      >
        <Button
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${branch.branch.label}`}
          onClick={() => { onToggleBranch(branch.branch.id); }}
          size="icon-sm"
          variant="ghost"
        >
          {collapsed
            ? <ChevronRightIcon className="size-3" />
            : <ChevronDownIcon className="size-3" />}
        </Button>
        <GitBranchIcon className="text-muted-foreground mr-1 size-3 shrink-0" />
        {editing
          ? (
            <input
              aria-label="Branch name"
              autoFocus
              className="bg-background border-input h-7 min-w-0 flex-1 rounded border px-1.5 text-xs outline-none focus:ring-2"
              maxLength={80}
              onBlur={() => { void submitRename(); }}
              onChange={event => { setLabel(event.target.value); }}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setLabel(branch.branch.label);
                  setEditing(false);
                }
              }}
              value={label}
            />
          )
          : (
            <span className="text-foreground min-w-0 flex-1 truncate font-medium">
              {branch.branch.label}
            </span>
          )}
        {!editing && (
          <Tooltip content="Rename branch">
            <Button
              aria-label={`Rename ${branch.branch.label}`}
              className="pointer-events-none opacity-0 group-focus-within/branch:pointer-events-auto group-focus-within/branch:opacity-100 group-hover/branch:pointer-events-auto group-hover/branch:opacity-100"
              onClick={beginRename}
              size="icon-sm"
              variant="ghost"
            >
              <PencilIcon className="size-3" />
            </Button>
          </Tooltip>
        )}
      </div>
      {!collapsed && (
        <div className="border-border/70 ml-3 flex flex-col gap-3 border-l pl-3">
          {branch.runs.map(run => (
            <section className="flex flex-col gap-2" key={run.id}>
              <div
                className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[0.625rem]"
                data-runtime-tree-node
                tabIndex={0}
              >
                <span
                  className="text-foreground/80 truncate font-medium"
                  title={run.id}
                >
                  Run {run.id.replace(/^run-/, "").slice(0, 8)}
                </span>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    "truncate",
                    run.failure && "text-destructive"
                  )}
                >
                  {run.failure
                    ? `Model limit reached · ${run.failure.consumed}/${run.failure.limit}`
                    : run.state === "waitingForApproval"
                      ? `Waiting for approval · ${pendingApprovalCounts.get(run.id) ?? 0} pending`
                      : RUNTIME_STATE_LABELS[run.state]}
                </span>
                {run.state === "waitingForApproval" && (
                  <Button
                    className="ml-auto h-5 px-1.5 text-[10px]"
                    onClick={onReviewApprovals}
                    size="sm"
                    variant="ghost"
                  >
                    Review
                  </Button>
                )}
              </div>
              {run.budgetWaits.map(wait => (
                <RuntimeBudgetBoundaryItem key={wait.id} wait={wait} />
              ))}
              {run.compactions.map(compaction => (
                <RuntimeCompactionItem
                  compaction={compaction}
                  key={compaction.id}
                  onInspect={onInspectCompaction}
                />
              ))}
              <ItemGroup className="gap-2!">
                {run.checkpoints.map(checkpoint => (
                  <RunHistoryItem
                    comparable={checkpoint.saved}
                    current={checkpoint.run.runtime?.checkpointId
                      === currentCheckpointId}
                    key={checkpoint.run.id}
                    newest={checkpoint.run.runtime?.checkpointId
                      === currentCheckpointId}
                    onCompactNow={workingBase?.branchId === branch.branch.id
                      && workingBase.checkpointId === currentCheckpointId
                      && checkpoint.run.runtime?.checkpointId
                      === currentCheckpointId
                      ? onCompactNow
                      : undefined}
                    onInspectRun={onInspectRun}
                    onRequestRemove={onRequestRemove}
                    onRestore={onRestore}
                    onToggleSelected={onToggleSelected}
                    run={checkpoint.run}
                    selected={selectedRunIds.includes(checkpoint.run.id)}
                    workingFrom={workingBase?.branchId === branch.branch.id
                      && workingBase.checkpointId
                      === checkpoint.run.runtime?.checkpointId}
                  />
                ))}
              </ItemGroup>
            </section>
          ))}
        </div>
      )}
    </section>
  );
});

const RuntimeCompactionItem = memo(({
  compaction,
  onInspect
}: {
  readonly compaction: RuntimeCompactionSnapshot;
  readonly onInspect: (id: string) => void;
}) => {
  return (
    <button
      aria-label={`Inspect context compaction from ${compaction.tokenEvidence.tokensBefore} to ${compaction.tokenEvidence.tokensAfter} tokens`}
      className="bg-muted/40 hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left focus-visible:ring-2"
      data-runtime-tree-node
      onClick={() => { onInspect(compaction.id); }}
      type="button"
    >
      <GitCompareArrowsIcon className="text-muted-foreground size-3 shrink-0" />
      <span className="min-w-0 flex-1 text-[0.6875rem] font-medium">
        Context compacted
      </span>
      <span className="text-muted-foreground shrink-0 text-[0.5625rem] tabular-nums">
        {compaction.tokenEvidence.tokensBefore.toLocaleString()} → {compaction.tokenEvidence.tokensAfter.toLocaleString()}
      </span>
    </button>
  );
});

const _RunHistoryItem = function RunHistoryItem({
  run,
  newest,
  selected,
  onToggleSelected,
  onInspectRun,
  onCompactNow,
  onRestore,
  onRequestRemove,
  current = false,
  workingFrom = false,
  comparable = true
}: {
  readonly comparable?: boolean;
  readonly current?: boolean;
  readonly newest: boolean;
  readonly onCompactNow?: () => void;
  readonly onInspectRun: (run: RunSnapshot) => void;
  readonly onRequestRemove: (run: RunSnapshot) => void;
  readonly onRestore: (run: RunSnapshot) => void;
  readonly onToggleSelected: (runId: string) => void;
  readonly run: RunSnapshot;
  readonly selected: boolean;
  readonly workingFrom?: boolean;
}) {
  const summary = summarizeRun(run.thread);
  const modelLabel = runModelLabel(run.thread);
  const messageCountLabel = runMessageCountLabel(run.thread);
  const runtimeProfileLabel = runRuntimeProfileLabel(run.runtime);
  const time = format(run.timestamp);
  const handleInspect = useCallback(() => {
    onInspectRun(run);
  }, [onInspectRun, run]);
  const handleInspectKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.currentTarget !== event.target) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onInspectRun(run);
      }
    },
    [onInspectRun, run]
  );
  const stopInspectClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);
  return (
    <Item
      aria-label={`Inspect run from ${time}: ${summary}`}
      className={cn(
        "group hover:bg-muted/70 focus-visible:ring-ring relative cursor-pointer flex-col items-start gap-1.5 focus-visible:ring-[3px]",
        selected && "ring-primary/50 ring-1",
        // Flash the newest run's background, fading to the resting color.
        newest && "animate-run-history-enter"
      )}
      data-runtime-tree-node
      onClick={handleInspect}
      onKeyDown={handleInspectKeyDown}
      role="listitem"
      size="sm"
      tabIndex={0}
      variant="muted"
    >
      <ItemContent className="flex w-full min-w-0 flex-row items-start gap-2">
        <ItemDescription className="text-foreground/60 group-hover:text-foreground line-clamp-2 min-w-0 flex-1 font-mono">
          {summary}
        </ItemDescription>
        <div className="shrink-0" onClick={stopInspectClick}>
          <Tooltip content="Remove run">
            <Button
              aria-label={`Remove run from ${time}`}
              className={cn(
                "hover:text-destructive pointer-events-none opacity-0 transition-opacity",
                "group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
              )}
              onClick={() => { onRequestRemove(run); }}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2Icon className="size-3" />
            </Button>
          </Tooltip>
        </div>
      </ItemContent>
      {(current || workingFrom) ? (
        <div className="flex w-full flex-wrap gap-1 text-[0.5625rem] font-medium">
          {current ? (
            <span className="bg-primary/15 text-primary rounded px-1 py-0.5">
              Current
            </span>
          ) : null}
          {workingFrom ? (
            <span className="bg-amber-500/15 text-amber-300 rounded px-1 py-0.5">
              Working from
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex w-full min-w-0 items-end gap-2">
        <div className="text-muted-foreground min-w-0 flex-1 text-[0.625rem]">
          <div className="truncate">
            {time} · {modelLabel}
            {runtimeProfileLabel ? ` · ${runtimeProfileLabel}` : null}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
            <span className="shrink-0 tabular-nums">{messageCountLabel}</span>
          </div>
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={stopInspectClick}
        >
          {comparable ? (
            <Tooltip content={selected ? "Remove from comparison" : "Select run"}>
              <Button
                aria-label={
                  selected
                    ? `Remove run from comparison: ${summary}`
                    : `Select run for comparison: ${summary}`
                }
                aria-pressed={selected}
                className={cn(
                  "text-muted-foreground/70 hover:text-foreground opacity-70 transition-opacity",
                  "group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
                  selected && "text-primary opacity-100"
                )}
                onClick={() => { onToggleSelected(run.id); }}
                size="icon-sm"
                variant="ghost"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-3 items-center justify-center rounded-[3px] border border-current",
                    selected
                    && "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {selected ? <CheckIcon className="size-2.5" /> : null}
                </span>
              </Button>
            </Tooltip>
          ) : null}
          {onCompactNow ? (
            <Tooltip content="Compact context now">
              <Button
                aria-label="Compact context now"
                onClick={onCompactNow}
                size="icon-sm"
                variant="ghost"
              >
                <Minimize2Icon className="size-3" />
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="Inspect run">
            <Button
              aria-label={`Inspect run from ${time}: ${summary}. ${modelLabel}. ${runtimeProfileLabel ? `${runtimeProfileLabel}. ` : ""}${messageCountLabel}`}
              onClick={() => { onInspectRun(run); }}
              size="icon-sm"
              variant="ghost"
            >
              <EyeIcon className="size-3" />
            </Button>
          </Tooltip>
          <Tooltip content="Restore run">
            <Button
              aria-label={`Restore run from ${time}: ${summary}. ${modelLabel}. ${runtimeProfileLabel ? `${runtimeProfileLabel}. ` : ""}${messageCountLabel}`}
              onClick={() => { onRestore(run); }}
              size="icon-sm"
              variant="ghost"
            >
              <RotateCcwIcon className="size-3" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </Item>
  );
};

const RunHistoryItem = memo(_RunHistoryItem);

const _EvaluationList = function EvaluationList({
  evaluations,
  runById,
  onOpenEvaluation,
  onRequestRemove
}: {
  readonly evaluations: EvaluationRecord[];
  readonly onOpenEvaluation: (leftRunId: string, rightRunId: string) => void;
  readonly onRequestRemove: (evaluation: EvaluationRecord) => void;
  readonly runById: Map<string, RunSnapshot>;
}) {
  const visibleEvaluations = evaluations
    .slice()
    .reverse()
    .flatMap(evaluation => {
      const leftRun = runById.get(evaluation.leftRunId);
      const rightRun = runById.get(evaluation.rightRunId);
      return leftRun && rightRun ? [{ evaluation, leftRun, rightRun }] : [];
    });

  if (visibleEvaluations.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="text-muted-foreground text-xs font-medium">
        Evaluations
      </div>
      <ItemGroup className="gap-2!">
        {visibleEvaluations.map(({ evaluation, leftRun, rightRun }) => (
          <EvaluationListItem
            evaluation={evaluation}
            key={evaluation.id}
            leftRun={leftRun}
            onOpenEvaluation={onOpenEvaluation}
            onRequestRemove={onRequestRemove}
            rightRun={rightRun}
          />
        ))}
      </ItemGroup>
    </div>
  );
};

const _EvaluationListItem = function EvaluationListItem({
  evaluation,
  leftRun,
  rightRun,
  onOpenEvaluation,
  onRequestRemove
}: {
  readonly evaluation: EvaluationRecord;
  readonly leftRun: RunSnapshot;
  readonly onOpenEvaluation: (leftRunId: string, rightRunId: string) => void;
  readonly onRequestRemove: (evaluation: EvaluationRecord) => void;
  readonly rightRun: RunSnapshot;
}) {
  const verdictLabel = VERDICT_LABELS[evaluation.verdict];
  const leftAverage = averageScoreForRun(
    evaluation.rubric,
    evaluation.runScores,
    evaluation.leftRunId
  );
  const rightAverage = averageScoreForRun(
    evaluation.rubric,
    evaluation.runScores,
    evaluation.rightRunId
  );
  const delta = evaluationScoreDelta(evaluation);
  const handleOpen = useCallback(() => {
    onOpenEvaluation(evaluation.leftRunId, evaluation.rightRunId);
  }, [evaluation.leftRunId, evaluation.rightRunId, onOpenEvaluation]);
  const handleOpenKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.currentTarget !== event.target) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpen();
      }
    },
    [handleOpen]
  );
  const stopOpenClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);
  return (
    <Item
      aria-label={`Open saved evaluation: ${verdictLabel}`}
      className="group hover:bg-foreground/5! focus-visible:ring-ring cursor-pointer flex-col items-start gap-1 focus-visible:ring-[3px]"
      onClick={handleOpen}
      onKeyDown={handleOpenKeyDown}
      role="listitem"
      size="sm"
      tabIndex={0}
      variant="outline"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-xs font-medium">{verdictLabel}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground text-[0.625rem]">
            {format(evaluation.updatedAt)}
          </span>
          <div onClick={stopOpenClick}>
            <Tooltip content="Remove evaluation">
              <Button
                aria-label={`Remove evaluation: ${verdictLabel}`}
                className={cn(
                  "hover:text-destructive pointer-events-none opacity-0 transition-opacity",
                  "group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                )}
                onClick={() => { onRequestRemove(evaluation); }}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2Icon className="size-3" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="text-muted-foreground line-clamp-2 w-full font-mono text-[0.625rem]">
        A: {summarizeRun(leftRun.thread)}
        {"\n"}B: {summarizeRun(rightRun.thread)}
      </div>
      {evaluation.rubric
        && leftAverage !== null
        && rightAverage !== null
        && delta !== null
        ? (
          <div className="w-full text-[0.625rem]">
            <div className="text-muted-foreground truncate">
              {evaluation.rubric.name} · v{evaluation.rubric.revision}
            </div>
            <div className="font-mono tabular-nums">
              A {leftAverage.toFixed(1)} · B {rightAverage.toFixed(1)} · Δ{" "}
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(1)}
            </div>
          </div>
        )
        : null}
      {evaluation.note
        ? (
          <div className="text-foreground/70 line-clamp-2 w-full text-[0.625rem]">
            {evaluation.note}
          </div>
        )
        : null}
    </Item>
  );
};

const EvaluationListItem = memo(_EvaluationListItem);
