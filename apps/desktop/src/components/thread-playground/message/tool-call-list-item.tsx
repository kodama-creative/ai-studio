import {
  isExecutableTool,
  type ThreadContext,
  type ThreadRuntimeProfileType,
  type ToolCall,
  type ToolCallInput
} from "@llm-space/core";
import { createToolResultPromptVariablePlaceKey } from "@llm-space/core/thread";
import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  Loader2,
  PlayIcon,
  RotateCcwIcon
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { RuntimeToolApprovalView } from "@llm-space/runtime/harness";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { openFirecrawlLimitDialog } from "@/components/firecrawl-limit-dialog";
import { PreviewDialog } from "@/components/preview-dialog-lazy";
import { useRenderingFidelity } from "@/components/theme-provider";
import { Tooltip } from "@/components/tooltip";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { cn } from "@/lib/utils";
import { AgentSubagentRunCard } from "./agent-subagent-run-card";
import { ToolCallInputView } from "./tool-call-input-view";
import {
  getToolCallOutputText,
  isToolCallOutcomeUnknown
} from "./tool-call-status";
import { useToolCallRunner } from "./use-tool-call-runner";
import {
  parseWebSearchOutput,
  WebSearchResultsView
} from "./web-search-results-view";
import { CodeEditor, type CodeEditorProps } from "../../code-editor";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { useAgentSubagentRun } from "../agent-subagent-runs-context";
import { useThreadStore, useThreadStoreActions } from "../stores";
import { getRuntimeExecutionMode } from "../stores/run-mode";
import { usePromptVariableExtensionForContext } from "../variable/use-prompt-variable-extension";

const _ToolCallListItem = function ToolCallListItem({
  context,
  messageId,
  toolCall,
  approval,
  runtimeProfileType,
  focusApproval,
  canContinue,
  onContinue,
  readonly = false
}: {
  readonly approval?: RuntimeToolApprovalView;
  readonly canContinue: boolean;
  readonly context?: ThreadContext;
  readonly focusApproval?: boolean;
  readonly messageId: string;
  readonly onContinue: () => void;
  readonly readonly?: boolean;
  readonly runtimeProfileType: ThreadRuntimeProfileType;
  readonly toolCall: ToolCall;
}) {
  const { fidelity } = useRenderingFidelity();
  const subagentRun = useAgentSubagentRun(toolCall.id);
  const status = useThreadStore(state => state.status);
  const runtimeSessionId = useThreadStore(state => (
    state.thread.runtimeSession as { snapshot?: { id?: string; }; } | undefined
  )?.snapshot?.id);
  const { decideToolApproval, updateToolCallOutputText } = useThreadStoreActions();
  const { resolveTool, runToolCall } = useToolCallRunner(messageId);
  const variableExtension = usePromptVariableExtensionForContext(
    createToolResultPromptVariablePlaceKey(messageId, toolCall.id),
    context
  );
  const tool = resolveTool(toolCall.input.name);
  const executable = tool !== undefined && isExecutableTool(tool);
  const [calling, setCalling] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const approvalRef = useRef<HTMLDivElement>(null);
  const [deciding, setDeciding] = useState(false);
  const [approvalConfirmation, setApprovalConfirmation] = useState<
    "approved" | "denied" | null
  >(null);
  const outputText = useMemo(() => getToolCallOutputText(toolCall), [toolCall]);
  const isError = toolCall.output?.isError ?? false;
  const outcomeUnknown = isToolCallOutcomeUnknown(toolCall) && !calling;
  const approvalManaged = approval !== undefined;
  const managedReadonly = readonly || approvalManaged;
  useEffect(() => {
    if (
      approval?.state === "pending"
      && focusApproval
      && status === "running"
    ) {
      approvalRef.current?.scrollIntoView({ block: "nearest" });
      approvalRef.current?.focus({ preventScroll: true });
    }
  }, [approval?.state, focusApproval, status]);
  const handleOutputChange = useCallback(
    (value: string) => {
      if (managedReadonly) {
        return;
      }
      updateToolCallOutputText(messageId, toolCall.id, value);
    },
    [managedReadonly, messageId, toolCall.id, updateToolCallOutputText]
  );
  const toggleError = useCallback(() => {
    if (managedReadonly) {
      return;
    }
    updateToolCallOutputText(messageId, toolCall.id, outputText, !isError);
  }, [
    isError,
    messageId,
    outputText,
    managedReadonly,
    toolCall.id,
    updateToolCallOutputText
  ]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (canContinue) {
          onContinue();
        } else {
          toast.error("Add tool responses before continuing");
        }
      }
    },
    [canContinue, onContinue]
  );
  const handleCall = useCallback(async () => {
    if (managedReadonly || !executable) {
      return;
    }
    setCalling(true);
    try {
      const outcome = await runToolCall(toolCall);
      if (outcome?.isError) {
        if (outcome.isFirecrawlLimit) {
          openFirecrawlLimitDialog();
        } else {
          toast.error(`Failed to call ${toolCall.input.name}()`);
        }
      }
    } finally {
      setCalling(false);
    }
  }, [executable, managedReadonly, runToolCall, toolCall]);
  const handleApproval = useCallback(async (
    decision: "approved" | "denied"
  ) => {
    if (!approval || deciding || approval.state !== "pending") { return; }
    setDeciding(true);
    try {
      await decideToolApproval(messageId, approval.id, decision);
      if (runtimeSessionId) {
        requestAnimationFrame(() => {
          const next = document.querySelector<HTMLElement>(
            `[data-runtime-session-id="${CSS.escape(runtimeSessionId)}"]`
            + '[data-tool-approval-state="pending"]'
          );
          next?.scrollIntoView({ block: "nearest" });
          next?.focus({ preventScroll: true });
        });
      }
    } catch (error) {
      toast.error("Unable to decide tool approval", {
        description: error instanceof Error ? error.message : "Approval failed"
      });
    } finally {
      setDeciding(false);
    }
  }, [
    approval,
    decideToolApproval,
    deciding,
    messageId,
    runtimeSessionId
  ]);
  const handleCopyArguments = useCallback(async () => {
    const text = formatJson(toolCall.input.arguments);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Arguments copied");
    } catch {
      toast.error("Failed to copy arguments");
    }
  }, [toolCall.input.arguments]);
  const handleRetry = useCallback(() => {
    setRetryOpen(false);
    void handleCall();
  }, [handleCall]);
  return (
    <div className="bg-foreground/4 flex w-full flex-col gap-2 rounded-md px-3 pt-2 pb-3">
      <div className="relative flex min-w-0 items-start">
        <ToolCallInputView input={toolCall.input} />
        <div className="absolute top-0 right-0 flex items-center">
          <Tooltip content="Copy arguments">
            <Button
              className="invisible shrink-0 group-hover/message:visible"
              onClick={() => void handleCopyArguments()}
              size="icon"
              variant="secondary"
            >
              <CopyIcon className="size-3" />
            </Button>
          </Tooltip>
          {executable && !outcomeUnknown && !approvalManaged
            ? (
              <Tooltip content="Call this tool">
                <Button
                  className="invisible shrink-0 group-hover/message:visible"
                  disabled={managedReadonly || calling}
                  onClick={() => void handleCall()}
                  size="icon"
                  variant="secondary"
                >
                  {calling
                    ? (
                      <Loader2 className="animate-spin" />
                    )
                    : (
                      <PlayIcon className="size-3" />
                    )}
                </Button>
              </Tooltip>
            )
            : null}
        </div>
      </div>
      <hr />
      {subagentRun
        ? <AgentSubagentRunCard run={subagentRun} />
        : approval && !toolCall.output
          ? (
            <div
              className="flex flex-col gap-2 outline-none"
              data-runtime-session-id={runtimeSessionId}
              data-tool-approval-state={approval.state}
              ref={approvalRef}
              role="status"
              tabIndex={-1}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium">
                    {_approvalLabel(approval)}
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {approval.reason ?? "Agent policy requires human approval"}
                  </div>
                </div>
                {approval.state === "pending"
                  ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        disabled={deciding}
                        onClick={() => { setApprovalConfirmation("approved"); }}
                        size="sm"
                      >
                        {getRuntimeExecutionMode() === "manual"
                          ? "Approve & run"
                          : "Approve"}
                      </Button>
                      <Button
                        disabled={deciding}
                        onClick={() => { setApprovalConfirmation("denied"); }}
                        size="sm"
                        variant="outline"
                      >
                        Deny
                      </Button>
                    </div>
                  )
                  : null}
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                <span>
                  Policy: Source {_approvalRequirementLabel(
                    approval.sourceRequirement
                  )} · Host {_approvalRequirementLabel(
                    approval.hostRequirement
                  )}
                </span>
                <span>
                  Scope: {approval.scope === "session"
                    ? "Once per session"
                    : "This call"}
                </span>
                <span>
                  Execution: {runtimeProfileType === "desktopSandbox"
                    ? "Sandbox"
                    : runtimeProfileType === "localServer"
                      ? "Local Server"
                      : "Direct"}
                </span>
              </div>
            </div>
          )
          : (
            <div className="flex w-full flex-col gap-1">
              <div className="text-muted-foreground flex min-w-0 items-center justify-between gap-2 text-xs">
                <Marker className="gap-1" role="status">
                  <MarkerContent className="flex items-center text-xs">
                    {outcomeUnknown
                      ? "Outcome unknown"
                      : approval?.state === "denied"
                        ? "Denied · not run"
                        : "Response"}
                    <Tooltip content="Preview response">
                      <Button
                        className="invisible shrink-0 group-hover/message:visible"
                        disabled={outputText === ""}
                        onClick={() => { setPreviewOpen(true); }}
                        size="xs"
                        variant="ghost"
                      >
                        <EyeIcon className="size-3" />
                      </Button>
                    </Tooltip>
                  </MarkerContent>
                </Marker>
                <div className="flex items-center">
                  {outcomeUnknown && executable
                    ? (
                      <Button
                        disabled={managedReadonly || calling}
                        onClick={() => { setRetryOpen(true); }}
                        size="xs"
                        variant="outline"
                      >
                        <RotateCcwIcon />
                        Retry
                      </Button>
                    )
                    : null}
                  <Button
                    className="invisible shrink-0 group-hover/message:visible"
                    disabled={managedReadonly}
                    onClick={toggleError}
                    size="xs"
                    variant={isError ? "destructive" : "ghost"}
                  >
                    <AlertCircleIcon />
                    {isError ? "Clear error" : "Mark as error"}
                  </Button>
                </div>
              </div>
              <PreviewDialog
                onOpenChange={setPreviewOpen}
                open={previewOpen}
                title={`Response of ${toolCall.input.name}()`}
                value={outputText}
              />
              <ToolCallResponseEditor
                extraExtensions={variableExtension}
                input={toolCall.input}
                onChange={handleOutputChange}
                onKeyDown={handleKeyDown}
                plain={fidelity === "lite"}
                readonly={managedReadonly}
                value={outputText}
              />
            </div>
          )}
      <ConfirmDialog
        confirmLabel={approvalConfirmation === "approved"
          ? getRuntimeExecutionMode() === "manual"
            ? "Approve & run"
            : "Approve"
          : "Deny"}
        confirmVariant={approvalConfirmation === "approved"
          ? "default"
          : "destructive"}
        description={approvalConfirmation === "approved"
          ? `This approval may run ${toolCall.input.name}() with the arguments shown above and cause external side effects.`
          : `This records ${toolCall.input.name}() as not run for this Runtime Run.`}
        onConfirm={() => {
          const decision = approvalConfirmation;
          setApprovalConfirmation(null);
          if (decision) { void handleApproval(decision); }
        }}
        onOpenChange={open => {
          if (!open) { setApprovalConfirmation(null); }
        }}
        open={approvalConfirmation !== null}
        title={approvalConfirmation === "approved"
          ? "Approve this tool call?"
          : "Deny this tool call?"}
      />
      <ConfirmDialog
        confirmLabel="Retry tool"
        confirmVariant="default"
        description="The previous call may have completed remotely. Retrying can repeat side effects."
        onConfirm={handleRetry}
        onOpenChange={setRetryOpen}
        open={retryOpen}
        title="Retry this tool?"
      />
    </div>
  );
};
export const ToolCallListItem = memo(_ToolCallListItem);

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function _approvalLabel(approval: RuntimeToolApprovalView): string {
  if (approval.state === "pending") { return "Approval required"; }
  if (approval.state === "approved") { return "Approved — ready to resume"; }
  if (approval.state === "denied") {
    return approval.sourceRequirement === "deny"
      || approval.hostRequirement === "deny"
      ? "Blocked by policy"
      : "Denied — not run";
  }
  return "Approval expired";
}

function _approvalRequirementLabel(
  requirement: RuntimeToolApprovalView["sourceRequirement"]
): string {
  if (requirement === "always") { return "every call"; }
  if (requirement === "once") { return "once per session"; }
  if (requirement === "deny") { return "deny"; }
  return "neutral";
}

// -- tool-call response editors -----------------------------------------------

/**
 * Picks the response editor for a tool call. Specialized editors (e.g.
 * {@link AskUserQuestionEditor}) render only when the tool call's input matches
 * their expected shape; anything else falls back to the plain code editor.
 */
const _ToolCallResponseEditor = function ToolCallResponseEditor({
  input,
  plain,
  value,
  readonly,
  extraExtensions,
  onChange,
  onKeyDown
}: {
  readonly extraExtensions: CodeEditorProps["extraExtensions"];
  readonly input: ToolCallInput;
  readonly onChange: (value: string) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
  readonly plain: boolean;
  readonly readonly: boolean;
  readonly value: string;
}) {
  const askUserQuestion = useMemo(
    () => parseAskUserQuestionInput(input),
    [input]
  );
  const webSearchResults = useMemo(
    () => parseWebSearchOutput(input, value),
    [input, value]
  );

  if (webSearchResults) {
    return <WebSearchResultsView results={webSearchResults} />;
  }

  if (askUserQuestion) {
    return (
      <AskUserQuestionEditor
        onChange={onChange}
        onKeyDown={onKeyDown}
        questions={askUserQuestion}
        readonly={readonly}
        value={value}
      />
    );
  }

  return (
    <CodeEditor
      className="max-h-96 min-h-9.5 px-0!"
      extraExtensions={extraExtensions}
      hideBorder
      hideFocusRing
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={`Enter the response of ${input.name}()`}
      plain={plain}
      readonly={readonly}
      scrollOnFocus
      value={value}
    />
  );
};
const ToolCallResponseEditor = memo(_ToolCallResponseEditor);

// -- ask_user_question --------------------------------------------------------

interface AskUserQuestionOption {
  label: string;
  description?: string;
}

interface AskUserQuestionItem {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

/** One question's selection: chosen option labels plus a free-form "Other". */
interface QuestionSelection {
  selected: string[];
  otherEnabled: boolean;
  otherText: string;
}

/**
 * Validate a tool call's input against the `ask_user_question` outline and, on
 * success, return the normalized questions. Returns `null` for any other tool
 * or a malformed payload, so the caller falls back to the default editor.
 */
function parseAskUserQuestionInput(
  input: ToolCallInput
): AskUserQuestionItem[] | null {
  if (input.name !== "ask_user_question") {
    return null;
  }
  const rawQuestions = (input.arguments as Record<string, unknown>)?.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const questions: AskUserQuestionItem[] = [];
  for (const rawQuestion of rawQuestions) {
    if (typeof rawQuestion !== "object" || rawQuestion === null) {
      return null;
    }
    const q = rawQuestion as Record<string, unknown>;
    if (typeof q.question !== "string" || q.question === "") {
      return null;
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      return null;
    }
    const options: AskUserQuestionOption[] = [];
    for (const rawOption of q.options) {
      if (typeof rawOption !== "object" || rawOption === null) {
        return null;
      }
      const o = rawOption as Record<string, unknown>;
      if (typeof o.label !== "string" || o.label === "") {
        return null;
      }
      options.push({
        label: o.label,
        description:
          typeof o.description === "string" ? o.description : undefined
      });
    }
    questions.push({
      question: q.question,
      header: typeof q.header === "string" ? q.header : undefined,
      options,
      multiSelect: q.multi_select === true
    });
  }
  return questions;
}

/** Seed each question's selection from the existing response JSON, if any. */
function _initSelections(
  questions: AskUserQuestionItem[],
  value: string
): QuestionSelection[] {
  let parsed: unknown;
  try {
    parsed = value ? JSON.parse(value) : null;
  } catch {
    parsed = null;
  }
  const rawAnswers =
    parsed !== null
    && typeof parsed === "object"
    && !Array.isArray(parsed)
    && typeof (parsed as Record<string, unknown>).answers === "object"
    && (parsed as Record<string, unknown>).answers !== null
      ? ((parsed as Record<string, unknown>).answers as Record<string, unknown>)
      : {};

  return questions.map(question => {
    const raw = rawAnswers[question.question];
    const answers = Array.isArray(raw)
      ? raw.filter((a): a is string => typeof a === "string")
      : typeof raw === "string"
        ? [raw]
        : [];
    const labels = new Set(question.options.map(o => o.label));
    const selected = answers.filter(a => labels.has(a));
    const other = answers.filter(a => !labels.has(a));
    return {
      selected: question.multiSelect ? selected : selected.slice(0, 1),
      otherEnabled: other.length > 0,
      otherText: other[0] ?? ""
    };
  });
}

/** Build one question's answer list: chosen labels plus the "Other" text. */
function _answerFor(selection: QuestionSelection): string[] {
  const answer = [...selection.selected];
  if (selection.otherEnabled) {
    answer.push(selection.otherText.trim() || "Other");
  }
  return answer;
}

/** Serialize selections to the response JSON string. */
function _serialize(
  questions: AskUserQuestionItem[],
  selections: QuestionSelection[]
): string {
  const answers: Record<string, string[]> = {};
  questions.forEach((question, index) => {
    answers[question.question] = _answerFor(selections[index]);
  });
  return JSON.stringify({ answers }, null, 2);
}

/**
 * A form-based response editor for `ask_user_question`: renders each question
 * with single- or multi-select options plus a free-form "Other". The response
 * is written back as `{ answers: { [question]: string[] } }` — one entry per
 * question, keyed by the question text, its value a list of the chosen option
 * labels (or the typed "Other").
 */
function AskUserQuestionEditor({
  questions,
  value,
  readonly,
  onChange,
  onKeyDown
}: {
  readonly onChange: (value: string) => void;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
  readonly questions: AskUserQuestionItem[];
  readonly readonly: boolean;
  readonly value: string;
}) {
  const [selections, setSelections] = useState<QuestionSelection[]>(() =>
    _initSelections(questions, value));

  const commit = useCallback(
    (index: number, next: QuestionSelection) => {
      if (readonly) {
        return;
      }
      const updated = selections.map((s, i) => (i === index ? next : s));
      setSelections(updated);
      onChange(_serialize(questions, updated));
    },
    [onChange, questions, readonly, selections]
  );

  const toggleOption = useCallback(
    (index: number, label: string) => {
      const question = questions[index];
      const current = selections[index];
      if (question.multiSelect) {
        const has = current.selected.includes(label);
        commit(index, {
          ...current,
          selected: has
            ? current.selected.filter(l => l !== label)
            : [...current.selected, label]
        });
        return;
      }
      // Single-select: exclusive with itself and with "Other".
      const isOnlySelected =
        current.selected.length === 1
        && current.selected[0] === label
        && !current.otherEnabled;
      commit(index, {
        selected: isOnlySelected ? [] : [label],
        otherEnabled: false,
        otherText: current.otherText
      });
    },
    [commit, questions, selections]
  );

  const toggleOther = useCallback(
    (index: number) => {
      const question = questions[index];
      const current = selections[index];
      if (question.multiSelect) {
        commit(index, { ...current, otherEnabled: !current.otherEnabled });
        return;
      }
      commit(index, {
        selected: [],
        otherEnabled: !current.otherEnabled,
        otherText: current.otherText
      });
    },
    [commit, questions, selections]
  );

  const setOtherText = useCallback(
    (index: number, text: string) => {
      const question = questions[index];
      const current = selections[index];
      commit(index, {
        selected: question.multiSelect ? current.selected : [],
        otherEnabled: true,
        otherText: text
      });
    },
    [commit, questions, selections]
  );

  return (
    <div className="flex w-full flex-col gap-4" onKeyDown={onKeyDown}>
      {questions.map((question, index) => {
        const selection = selections[index];
        return (
          <div className="flex flex-col gap-2" key={index}>
            {question.header
              ? (
                <div className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
                  {question.header}
                </div>
              )
              : null}
            <div className="text-sm font-medium">{question.question}</div>
            <div className="flex flex-col gap-1">
              {question.options.map(option => (
                <OptionRow
                  description={option.description}
                  disabled={readonly}
                  key={option.label}
                  label={option.label}
                  multiSelect={question.multiSelect}
                  onClick={() => { toggleOption(index, option.label); }}
                  selected={selection.selected.includes(option.label)}
                />
              ))}
              <OptionRow
                disabled={readonly}
                label="Other"
                multiSelect={question.multiSelect}
                onClick={() => { toggleOther(index); }}
                selected={selection.otherEnabled}
              />
              {selection.otherEnabled
                ? (
                  <Input
                    aria-label={`Other answer for "${question.question}"`}
                    className="ml-6 h-8 w-[calc(100%-1.5rem)]"
                    disabled={readonly}
                    onChange={e => { setOtherText(index, e.target.value); }}
                    placeholder="Type your answer…"
                    value={selection.otherText}
                  />
                )
                : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One selectable option row: a radio (single) or checkbox (multi) affordance. */
function OptionRow({
  label,
  description,
  multiSelect,
  selected,
  disabled,
  onClick
}: {
  readonly description?: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly multiSelect: boolean;
  readonly onClick: () => void;
  readonly selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        "hover:bg-foreground/6 disabled:cursor-default disabled:hover:bg-transparent"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors",
          multiSelect ? "rounded-[4px]" : "rounded-full",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input"
        )}
      >
        {selected ? <CheckIcon className="size-3" /> : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {description ? <span className="text-muted-foreground text-xs">{description}</span> : null}
      </span>
    </button>
  );
}
