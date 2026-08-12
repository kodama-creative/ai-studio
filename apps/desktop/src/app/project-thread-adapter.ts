import type { Thread, Tool } from "@llm-space/core";
import type {
  EvaluationRecord,
  EvaluationRubricRecord,
} from "@llm-space/core/thread";
import type {
  StudioThread,
  StudioThreadDocument,
  StudioRunHistoryEntry,
} from "@llm-space/studio";
import type {
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
  Evaluation,
  EvaluationInput,
  EvaluationRubric,
  EvaluationRubricInput,
} from "@llm-space/studio/evaluation";
import type { ExternalThreadExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type { ProjectStudioClient } from "@/client/project-studio-client";

export function studioThreadToPlaygroundThread(
  thread: StudioThread,
  history: readonly StudioRunHistoryEntry[] = [],
  evaluationMetadata?: StudioEvaluationMetadata
): Thread {
  const model = _modelConfig(thread.document.agent.model);
  const runHistory = history.flatMap((entry) =>
    entry.checkpoint === undefined || entry.run.status !== "completed"
      ? []
      : [
          {
            id: entry.run.id,
            thread: studioThreadToPlaygroundThread({
              ...thread,
              document: entry.checkpoint.document,
              activeRunId: undefined,
            }),
            timestamp: entry.run.completedAt ?? entry.run.createdAt,
          },
        ]
  );
  return {
    title: thread.document.title,
    ...(model === undefined ? {} : { model }),
    context: {
      systemPrompt: thread.document.agent.instructions.join("\n\n"),
      tools: thread.document.agent.tools.map((tool): Tool => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
      messages: [...structuredClone(thread.document.conversation.messages)],
    },
    ...(runHistory.length === 0 ? {} : { runHistory }),
    ...(evaluationMetadata?.evaluations.length
      ? {
          evaluations: evaluationMetadata.evaluations.map(
            _toPlaygroundEvaluation
          ),
        }
      : {}),
    ...(evaluationMetadata?.rubrics.length
      ? {
          evaluationRubrics:
            evaluationMetadata.rubrics.map(_toPlaygroundRubric),
        }
      : {}),
  };
}

export function playgroundThreadToStudioEvaluationMetadata(thread: {
  readonly evaluations?: readonly EvaluationRecord[];
  readonly evaluationRubrics?: readonly EvaluationRubricRecord[];
}): StudioEvaluationMetadataInput {
  return {
    evaluations: (thread.evaluations ?? []).map((evaluation): EvaluationInput =>
      structuredClone(evaluation)
    ),
    rubrics: (thread.evaluationRubrics ?? []).map(
      (rubric): EvaluationRubricInput => structuredClone(rubric)
    ),
  };
}

function _toPlaygroundEvaluation(evaluation: Evaluation): EvaluationRecord {
  const base = {
    id: evaluation.id,
    leftRunId: evaluation.leftRunId,
    rightRunId: evaluation.rightRunId,
    verdict: evaluation.verdict,
    ...(evaluation.note === undefined ? {} : { note: evaluation.note }),
    createdAt: evaluation.createdAt,
    updatedAt: evaluation.updatedAt,
  };
  if (evaluation.rubric === undefined) return base;
  return {
    ...base,
    rubric: {
      ...evaluation.rubric,
      criteria: evaluation.rubric.criteria.map((item) => ({ ...item })),
    },
    runScores: evaluation.runScores.map((item) => ({
      ...item,
      scores: item.scores.map((score) => ({ ...score })),
    })),
  };
}

function _toPlaygroundRubric(rubric: EvaluationRubric): EvaluationRubricRecord {
  return {
    id: rubric.id,
    name: rubric.name,
    criteria: rubric.criteria.map((item) => ({ ...item })),
    revision: rubric.revision,
    createdAt: rubric.createdAt,
    updatedAt: rubric.updatedAt,
  };
}

export function playgroundThreadToStudioDocument(
  thread: Thread,
  base: StudioThread
): StudioThreadDocument {
  return {
    ...base.document,
    title: thread.title ?? base.document.title,
    conversation: {
      state: base.document.conversation.state,
      messages: structuredClone(thread.context?.messages ?? []),
    },
  };
}

export function createProjectThreadExecutionRuntime(input: {
  readonly client: ProjectStudioClient;
  readonly threadId: string;
  readonly getThread: () => StudioThread;
  readonly onThread: (thread: StudioThread) => void;
  readonly beforeExecute?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}): ExternalThreadExecutionRuntime {
  return {
    async *execute(request) {
      await input.beforeExecute?.();
      let studioThread = input.getThread();
      let receipt: { readonly runId: string };
      if (studioThread.activeRunId === undefined) {
        studioThread = await input.client.saveDocument(
          input.threadId,
          playgroundThreadToStudioDocument(request.thread, studioThread)
        );
        input.onThread(studioThread);
        const fromMessageId =
          request.fromMessageId ?? request.thread.context?.messages?.at(-1)?.id;
        if (fromMessageId === undefined) {
          throw new Error("A Studio Run requires at least one message.");
        }
        receipt = await input.client.run(input.threadId, {
          fromMessageId,
          mode: request.reactLoop ? "continue" : "step",
        });
      } else if (request.reactLoop) {
        receipt = await input.client.continueRun(studioThread.activeRunId);
      } else {
        receipt = await input.client.stepRun(studioThread.activeRunId);
      }
      const streaming = new Map<string, string>();
      let [history, evaluationMetadata] = await Promise.all([
        input.client.listRunHistory(input.threadId),
        input.client.listEvaluationMetadata(input.threadId),
      ]);
      let afterSequence: number | undefined;
      try {
        while (true) {
          let advancedTool = false;
          for await (const item of input.client.events(input.threadId, {
            ...(afterSequence === undefined ? {} : { afterSequence }),
            follow: true,
            signal: request.signal,
          })) {
            afterSequence = item.sequence;
            const event = item.event;
            if (
              event.type === "message.delta" &&
              event.runId === receipt.runId
            ) {
              const text = `${streaming.get(event.messageId) ?? ""}${event.delta}`;
              streaming.set(event.messageId, text);
              yield {
                type: "message.delta",
                message: {
                  id: event.messageId,
                  role: "assistant",
                  content: [{ type: "text", text }],
                },
              };
            } else if (
              event.type === "conversation.updated" &&
              event.runId === receipt.runId
            ) {
              studioThread = event.thread;
              input.onThread(studioThread);
              yield {
                type: "thread.updated",
                thread: studioThreadToPlaygroundThread(
                  studioThread,
                  history,
                  evaluationMetadata
                ),
              };
            } else if (
              event.type === "run.paused" &&
              event.run.id === receipt.runId
            ) {
              const latest = await input.client.loadThread(input.threadId);
              if (latest !== undefined) {
                studioThread = latest;
                input.onThread(latest);
                yield {
                  type: "thread.updated",
                  thread: studioThreadToPlaygroundThread(
                    latest,
                    history,
                    evaluationMetadata
                  ),
                };
              }
              const pending =
                !request.reactLoop && request.autoRunTools
                  ? _pendingToolCalls(studioThread)[0]
                  : undefined;
              if (pending === undefined) return;
              receipt = await input.client.stepRun(receipt.runId, {
                toolCallId: pending.id,
              });
              advancedTool = true;
              break;
            } else if (
              event.type === "run.completed" &&
              event.runId === receipt.runId
            ) {
              const [latest, nextHistory, nextEvaluationMetadata] =
                await Promise.all([
                  input.client.loadThread(input.threadId),
                  input.client.listRunHistory(input.threadId),
                  input.client.listEvaluationMetadata(input.threadId),
                ]);
              history = nextHistory;
              evaluationMetadata = nextEvaluationMetadata;
              if (latest !== undefined) {
                studioThread = latest;
                input.onThread(latest);
                yield {
                  type: "thread.updated",
                  thread: studioThreadToPlaygroundThread(
                    latest,
                    history,
                    evaluationMetadata
                  ),
                };
              }
              return;
            } else if (
              event.type === "run.failed" &&
              event.runId === receipt.runId
            ) {
              throw new Error(event.message);
            } else if (
              event.type === "run.cancelled" &&
              event.runId === receipt.runId
            ) {
              return;
            }
          }
          if (!advancedTool) {
            throw new Error(
              `Run "${receipt.runId}" event stream ended before it settled.`
            );
          }
        }
      } finally {
        if (request.signal.aborted) {
          await input.client.cancelRun(receipt.runId);
        }
        await input.onSettled?.();
      }
    },
    async *executeToolCall(request) {
      await input.beforeExecute?.();
      const studioThread = input.getThread();
      const runId = studioThread.activeRunId;
      if (runId === undefined) {
        throw new Error("The tool call does not belong to an active Run.");
      }
      try {
        await input.client.stepRun(runId, {
          toolCallId: request.toolCallId,
        });
        for await (const item of input.client.events(input.threadId, {
          follow: true,
          signal: request.signal,
        })) {
          const event = item.event;
          if (
            (event.type === "tool.updated" ||
              event.type === "tool.completed") &&
            event.runId === runId &&
            event.toolCallId === request.toolCallId
          ) {
            yield {
              type: "thread.updated",
              thread: _replaceAssistant(
                studioThreadToPlaygroundThread(input.getThread()),
                event.message
              ),
            };
          }
          if (event.type === "run.paused" && event.run.id === runId) {
            const latest = await input.client.loadThread(input.threadId);
            if (latest !== undefined) {
              input.onThread(latest);
              yield {
                type: "thread.updated",
                thread: studioThreadToPlaygroundThread(latest),
              };
            }
            return;
          }
          if (event.type === "run.failed" && event.runId === runId) {
            throw new Error(event.message);
          }
          if (
            (event.type === "run.completed" ||
              event.type === "run.cancelled") &&
            event.runId === runId
          ) {
            return;
          }
        }
      } finally {
        if (request.signal.aborted) await input.client.cancelRun(runId);
        await input.onSettled?.();
      }
    },
  };
}

function _pendingToolCalls(thread: StudioThread) {
  const last = thread.document.conversation.messages.at(-1);
  return last?.role === "assistant"
    ? (last.toolCalls ?? []).filter((call) => call.output === undefined)
    : [];
}

function _replaceAssistant(
  thread: Thread,
  assistant: import("@llm-space/core").AssistantMessage
): Thread {
  const messages = [...(thread.context?.messages ?? [])];
  const index = messages.findIndex((message) => message.id === assistant.id);
  if (index === -1) messages.push(assistant);
  else messages[index] = assistant;
  return { ...thread, context: { ...thread.context, messages } };
}

function _modelConfig(model: StudioThread["document"]["agent"]["model"]) {
  if (typeof model !== "string") return undefined;
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) return undefined;
  return {
    provider: model.slice(0, separator),
    id: model.slice(separator + 1),
  };
}
