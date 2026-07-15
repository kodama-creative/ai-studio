import {
  type EvaluationRecord,
  type EvaluationRubricInput,
  type EvaluationRubricRecord,
  type EvaluationRubricSnapshot,
  type EvaluationRunScores,
  type RunSnapshot,
  snapshotEvaluationRubric
} from "@llm-space/core/thread";
import { ArrowLeftIcon, CheckIcon, EyeIcon, SaveIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "timeago.js";

import { cn } from "@/lib/utils";
import { EvaluationRubricEditor } from "./evaluation-rubric-editor";
import { RunEvaluationScorecard } from "./run-evaluation-scorecard";
import {
  completeRunScores,
  type EvaluationScoreDraft,
  initialRubricForEvaluation,
  requiresScoreRemovalConfirmation,
  scoreDraftForRubricChange,
  scoreDraftFromEvaluation
} from "./run-evaluation-utils";
import {
  runLastUserText,
  runMessageCountLabel,
  runModelLabel,
  runResultText,
  summarizeRun
} from "./run-history-utils";
import { RunTraceView } from "./run-trace-view";
import { ConfirmDialog } from "../confirm-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

const VERDICT_OPTIONS: Array<{
  label: string;
  value: EvaluationRecord["verdict"];
}> = [
  { value: "leftBetter", label: "Run A Better" },
  { value: "rightBetter", label: "Run B Better" },
  { value: "tie", label: "Tie" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" }
];

export function RunEvaluationDialog({
  open,
  leftRun,
  rightRun,
  evaluation,
  rubrics,
  preferredRubricId,
  onOpenChange,
  onSave,
  onSaveRubric,
  onRemoveRubric
}: {
  readonly evaluation: EvaluationRecord | null;
  readonly leftRun: RunSnapshot | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemoveRubric: (id: string) => boolean;
  readonly onSave: (input: {
    leftRunId: string;
    note?: string;
    rightRunId: string;
    rubric?: EvaluationRubricSnapshot;
    runScores?: EvaluationRunScores[];
    verdict: EvaluationRecord["verdict"];
  }) => boolean;
  readonly onSaveRubric: (input: EvaluationRubricInput) => EvaluationRubricRecord | null;
  readonly open: boolean;
  readonly preferredRubricId: string | null;
  readonly rightRun: RunSnapshot | null;
  readonly rubrics: EvaluationRubricRecord[];
}) {
  const [verdict, setVerdict] = useState<EvaluationRecord["verdict"] | null>(
    null
  );
  const [note, setNote] = useState("");
  const [inspectingRun, setInspectingRun] = useState<RunSnapshot | null>(null);
  const [rubricEditorOpen, setRubricEditorOpen] = useState(false);
  const [editingRubric, setEditingRubric] =
    useState<EvaluationRubricRecord | null>(null);
  const [selectedRubric, setSelectedRubric] =
    useState<EvaluationRubricSnapshot | null>(null);
  const [scoreDraft, setScoreDraft] = useState<EvaluationScoreDraft>({});
  const [removeScoresOpen, setRemoveScoresOpen] = useState(false);

  const [prevOpen, setPrevOpen] = useState(false);
  const identity = `${leftRun?.id ?? ""}:${rightRun?.id ?? ""}:${evaluation?.id ?? ""}`;
  const [prevIdentity, setPrevIdentity] = useState(identity);

  // Reinitialize the dialog when it opens or the run/evaluation identity changes. Adjusting
  // during render (not via useEffect) avoids a stale frame between the two
  // commits. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (open !== prevOpen || identity !== prevIdentity) {
    setPrevOpen(open);
    setPrevIdentity(identity);
    setInspectingRun(null);
    setRubricEditorOpen(false);
    setEditingRubric(null);
    setRemoveScoresOpen(false);
    if (open) {
      const preferredRubric = preferredRubricId
        ? rubrics.find(rubric => rubric.id === preferredRubricId)
        : undefined;
      setVerdict(evaluation?.verdict ?? null);
      setNote(evaluation?.note ?? "");
      setSelectedRubric(
        initialRubricForEvaluation(
          evaluation,
          preferredRubric ? snapshotEvaluationRubric(preferredRubric) : null
        )
      );
      setScoreDraft(scoreDraftFromEvaluation(evaluation));
    }
  }

  const title = useMemo(() => {
    if (!leftRun || !rightRun) {
      return "Compare Runs";
    }
    return `${format(leftRun.timestamp)} vs ${format(rightRun.timestamp)}`;
  }, [leftRun, rightRun]);

  const runScores = useMemo(() => {
    if (!selectedRubric || !leftRun || !rightRun) {
      return null;
    }
    return completeRunScores(selectedRubric, scoreDraft, [
      leftRun.id,
      rightRun.id
    ]);
  }, [leftRun, rightRun, scoreDraft, selectedRubric]);
  const canSave = Boolean(verdict && (!selectedRubric || runScores !== null));

  const handleRubricChange = (rubric: EvaluationRubricSnapshot | null) => {
    if (leftRun && rightRun) {
      setScoreDraft(current =>
        scoreDraftForRubricChange(
          current,
          selectedRubric,
          rubric,
          [leftRun.id, rightRun.id],
          evaluation
        ));
    }
    setSelectedRubric(rubric);
  };

  const persistEvaluation = () => {
    if (!leftRun || !rightRun || !verdict) {
      return;
    }
    if (selectedRubric && !runScores) {
      return;
    }
    const saved = onSave({
      leftRunId: leftRun.id,
      rightRunId: rightRun.id,
      verdict,
      note,
      ...(selectedRubric && runScores
        ? { rubric: selectedRubric, runScores }
        : {})
    });
    if (!saved) {
      toast.error("Unable to save evaluation", {
        description: "Check the selected runs and rubric scores."
      });
      return;
    }
    toast.success("Evaluation saved");
    onOpenChange(false);
  };

  const handleSave = () => {
    if (requiresScoreRemovalConfirmation(evaluation, selectedRubric)) {
      setRemoveScoresOpen(true);
      return;
    }
    persistEvaluation();
  };

  const dialogTitle = inspectingRun
    ? "Inspect Run"
    : rubricEditorOpen
      ? editingRubric
        ? "Edit rubric"
        : "Create rubric"
      : "Evaluate Runs";
  const dialogDescription = inspectingRun
    ? "Saved run evidence from this comparison."
    : rubricEditorOpen
      ? "Create reusable criteria for manual run comparison in this thread."
      : "Compare two durable runs and save a structured evaluation with this thread.";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[min(1040px,calc(100vw-2rem))] max-w-none! flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        {inspectingRun
          ? (
            <>
              <RunTraceView className="min-h-0 flex-1" run={inspectingRun} />
              <div className="flex justify-end border-t px-4 py-3">
                <Button onClick={() => { setInspectingRun(null); }} variant="ghost">
                  <ArrowLeftIcon className="size-3" />
                  Back to Evaluation
                </Button>
              </div>
            </>
          )
          : rubricEditorOpen
            ? (
              <EvaluationRubricEditor
                key={editingRubric?.id ?? "new-rubric"}
                onBack={() => { setRubricEditorOpen(false); }}
                onRemove={id => {
                  const removed = onRemoveRubric(id);
                  const savedSnapshot = evaluation?.rubric;
                  if (
                    removed
                    && selectedRubric?.id === id
                    && (savedSnapshot?.id !== selectedRubric.id
                      || savedSnapshot?.revision !== selectedRubric.revision)
                  ) {
                    setSelectedRubric(null);
                  }
                  return removed;
                }}
                onSave={onSaveRubric}
                onSaved={rubric => {
                  const snapshot = snapshotEvaluationRubric(rubric);
                  handleRubricChange(snapshot);
                  setEditingRubric(rubric);
                  setRubricEditorOpen(false);
                }}
                rubric={editingRubric}
              />
            )
            : leftRun && rightRun
              ? (
                <>
                  <div className="min-h-0 overflow-y-auto px-4 py-4">
                    <div className="text-muted-foreground mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>{title}</span>
                      {evaluation ? <span>Last saved {format(evaluation.updatedAt)}</span> : null}
                    </div>
                    <div className="flex flex-col gap-3 lg:flex-row">
                      <_RunComparisonPanel
                        label="Run A"
                        onInspectRun={setInspectingRun}
                        run={leftRun}
                      />
                      <_RunComparisonPanel
                        label="Run B"
                        onInspectRun={setInspectingRun}
                        run={rightRun}
                      />
                    </div>
                    <div className="mt-4 flex flex-col gap-3">
                      <RunEvaluationScorecard
                        leftRunId={leftRun.id}
                        onCreateRubric={() => {
                          setEditingRubric(null);
                          setRubricEditorOpen(true);
                        }}
                        onEditRubric={rubric => {
                          setEditingRubric(rubric);
                          setRubricEditorOpen(true);
                        }}
                        onRubricChange={handleRubricChange}
                        onScoreChange={(runId, criterionId, score) => {
                          setScoreDraft(current => ({
                            ...current,
                            [runId]: {
                              ...(current[runId] ?? {}),
                              [criterionId]: score
                            }
                          }));
                        }}
                        rightRunId={rightRun.id}
                        rubric={selectedRubric}
                        rubrics={rubrics}
                        savedRubric={evaluation?.rubric ?? null}
                        scoreDraft={scoreDraft}
                      />
                      <div>
                        <div className="text-xs font-medium">Verdict</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {VERDICT_OPTIONS.map(option => {
                            const selected = verdict === option.value;
                            return (
                              <Button
                                aria-pressed={selected}
                                key={option.value}
                                onClick={() => { setVerdict(option.value); }}
                                type="button"
                                variant={selected ? "default" : "outline"}
                              >
                                {selected ? <CheckIcon className="size-3" /> : null}
                                {option.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      <label className="flex flex-col gap-2">
                        <span className="text-xs font-medium">Evaluation Note</span>
                        <Textarea
                          className="min-h-24"
                          onChange={event => { setNote(event.target.value); }}
                          placeholder="Why did this run pass, fail, or beat the other one?"
                          value={note}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 border-t px-4 py-3">
                    <Button onClick={() => { onOpenChange(false); }} variant="ghost">
                      Close
                    </Button>
                    <Button disabled={!canSave} onClick={handleSave}>
                      <SaveIcon className="size-3" />
                      Save Evaluation
                    </Button>
                  </div>
                </>
              )
              : (
                <div className="text-muted-foreground px-4 py-8 text-center text-xs">
                  Select two runs to compare.
                </div>
              )}
      </DialogContent>
      <ConfirmDialog
        confirmLabel="Remove scores and save"
        description="Saving without a rubric permanently removes the saved rubric snapshot and all criterion scores from this evaluation. This cannot be undone."
        dimBackground={false}
        onConfirm={() => {
          setRemoveScoresOpen(false);
          persistEvaluation();
        }}
        onOpenChange={setRemoveScoresOpen}
        open={removeScoresOpen}
        title="Remove rubric scores?"
      />
    </Dialog>
  );
}

const _RunComparisonPanel = function RunComparisonPanel({
  label,
  run,
  onInspectRun
}: {
  readonly label: string;
  readonly onInspectRun: (run: RunSnapshot) => void;
  readonly run: RunSnapshot;
}) {
  return (
    <section className="bg-muted/30 flex min-w-0 flex-1 flex-col rounded-lg border">
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium">{label}</div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label={`Inspect ${label}: ${summarizeRun(run.thread)}`}
              onClick={() => { onInspectRun(run); }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <EyeIcon className="size-3" />
              Inspect
            </Button>
            <div className="text-muted-foreground text-[0.625rem]">
              {format(run.timestamp)}
            </div>
          </div>
        </div>
        <div className="text-muted-foreground mt-1 line-clamp-2 font-mono text-xs">
          {summarizeRun(run.thread)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-b px-3 py-2 text-[0.625rem]">
        <_MetaValue label="Model" value={runModelLabel(run.thread)} />
        <_MetaValue label="Messages" value={runMessageCountLabel(run.thread)} />
        <_MetaValue
          label="Captured"
          value={new Date(run.timestamp).toLocaleString()}
        />
      </div>
      <div className="flex min-h-0 flex-col gap-3 p-3">
        <_TextExcerpt
          label="System Prompt"
          value={run.thread.context?.systemPrompt?.trim() || "No system prompt"}
        />
        <_TextExcerpt
          label="Last User Message"
          value={runLastUserText(run.thread)}
        />
        <_TextExcerpt label="Result" value={runResultText(run.thread)} />
      </div>
    </section>
  );
};

const _MetaValue = function MetaValue({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className="flex min-w-0 gap-1">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  );
};

const _TextExcerpt = function TextExcerpt({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="text-muted-foreground text-[0.625rem] font-medium">
        {label}
      </div>
      <pre
        className={cn(
          "bg-background/70 max-h-40 overflow-auto rounded-md border px-2 py-2",
          "font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap"
        )}
      >
        {value}
      </pre>
    </div>
  );
};
