import type { ModelConfig, Thread, Tool } from "@llm-space/core";
import type {
  EvaluationRecord,
  EvaluationRubricRecord,
} from "@llm-space/core/thread";
import type {
  StudioRunHistoryEntry,
  StudioThread,
  StudioThreadDocument,
} from "@llm-space/studio";
import type {
  Evaluation,
  EvaluationInput,
  EvaluationRubric,
  EvaluationRubricInput,
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
} from "@llm-space/studio/evaluation";
import type { ExternalThreadExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type { ProjectStudioTransport } from "@/shared/project-studio";
import type { ThreadClient, ThreadTarget } from "@/shared/thread-rpc";

/** Projects a Pi-backed Experiment and its operation metadata to the editor. */
export function studioThreadToPlaygroundThread(
  thread: StudioThread,
  history: readonly StudioRunHistoryEntry[] = [],
  evaluationMetadata?: StudioEvaluationMetadata
): Thread {
  const model = _modelConfig(thread.document.agent.model);
  const runHistory = history.flatMap((entry) =>
    entry.checkpoint === undefined || entry.operation.status !== "completed"
      ? []
      : [
          {
            id: entry.operation.operationId,
            thread: studioThreadToPlaygroundThread({
              ...thread,
              document: entry.checkpoint.document,
              operationId: undefined,
            }),
            timestamp: entry.operation.finishedAt ?? entry.operation.startedAt,
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
      ? { evaluations: evaluationMetadata.evaluations.map(_toEditorEvaluation) }
      : {}),
    ...(evaluationMetadata?.rubrics.length
      ? { evaluationRubrics: evaluationMetadata.rubrics.map(_toEditorRubric) }
      : {}),
  };
}

/** Converts editor evaluation ids back to Studio's Pi operation vocabulary. */
export function playgroundThreadToStudioEvaluationMetadata(thread: {
  readonly evaluations?: readonly EvaluationRecord[];
  readonly evaluationRubrics?: readonly EvaluationRubricRecord[];
}): StudioEvaluationMetadataInput {
  return {
    evaluations: (thread.evaluations ?? []).map(_toStudioEvaluation),
    rubrics: (thread.evaluationRubrics ?? []).map(
      (rubric): EvaluationRubricInput => structuredClone(rubric)
    ),
  };
}

/** Splits an editor document while retaining Studio-owned Agent/state metadata. */
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

/** Detects whether the editor projection differs from the current Studio view. */
export function shouldPersistProjectThread(
  thread: Thread,
  base: StudioThread
): boolean {
  return !_sameJson(
    playgroundThreadToStudioDocument(thread, base),
    base.document
  );
}

/** Adapts Project editor controls directly to product-owned Thread RPC. */
export function createProjectThreadExecutionRuntime(input: {
  readonly client: ProjectStudioTransport;
  readonly threadClient?: ThreadClient;
  readonly projectId: string;
  readonly threadId: string;
  readonly getThread: () => StudioThread;
  readonly onThread: (thread: StudioThread) => void;
  readonly beforeExecute?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}): ExternalThreadExecutionRuntime {
  const target: ThreadTarget = {
    kind: "experiment",
    projectId: input.projectId,
    experimentId: input.threadId,
  };
  return {
    async *execute(request) {
      await input.beforeExecute?.();
      const client = await _threadClient(input);
      let studioThread = input.getThread();
      try {
        if (studioThread.operationId === undefined) {
          studioThread = await input.client.saveDocument(
            input.threadId,
            playgroundThreadToStudioDocument(request.thread, studioThread)
          );
          input.onThread(studioThread);
          const fromMessageId =
            request.fromMessageId ??
            request.thread.context?.messages?.at(-1)?.id;
          if (fromMessageId === undefined) {
            throw new Error(
              "A Studio operation requires at least one Message."
            );
          }
          const message = request.thread.context?.messages?.find(
            (candidate) => candidate.id === fromMessageId
          );
          if (message?.role !== "user") {
            throw new Error(
              `Studio operation input "${fromMessageId}" must be a user Message.`
            );
          }
          const modelOverride = _modelDefinition(request.thread.model);
          await client.run(target, {
            fromMessageId,
            commandId: crypto.randomUUID(),
            mode: request.reactLoop ? "continue" : "step",
            ...(modelOverride === undefined ? {} : { modelOverride }),
          });
        } else if (request.reactLoop) {
          await client.continue(target, studioThread.operationId, {
            commandId: crypto.randomUUID(),
          });
        } else {
          await _stepCurrent(client, target, studioThread.operationId);
        }

        if (!request.reactLoop && request.autoRunTools) {
          studioThread = await _requireThread(input);
          while (studioThread.operationId !== undefined) {
            const snapshot = await client.inspect(
              target,
              studioThread.operationId
            );
            if (snapshot.nextAction?.kind !== "tool") break;
            await _stepCurrent(
              client,
              target,
              studioThread.operationId,
              snapshot
            );
            studioThread = await _requireThread(input);
          }
        }
        yield* _refresh(
          input,
          request.thread.model,
          client,
          target,
          request.reactLoop ? "continue" : "step"
        );
      } finally {
        if (request.signal.aborted && studioThread.operationId !== undefined) {
          await client.cancel(target, studioThread.operationId);
        }
        await input.onSettled?.();
      }
    },

    async *executeToolCall(request) {
      await input.beforeExecute?.();
      const client = await _threadClient(input);
      const studioThread = input.getThread();
      if (studioThread.operationId === undefined) {
        throw new Error(
          "The tool call does not belong to an active operation."
        );
      }
      try {
        const snapshot = await client.inspect(
          target,
          studioThread.operationId
        );
        const action = snapshot.nextAction;
        if (
          action?.kind !== "tool" ||
          action.toolCallId !== request.toolCallId
        ) {
          throw new Error(
            `Tool call "${request.toolCallId}" is not the current Pi action.`
          );
        }
        yield { type: "tool.started", toolCallId: request.toolCallId };
        await _stepCurrent(
          client,
          target,
          studioThread.operationId,
          snapshot
        );
        yield { type: "tool.completed", toolCallId: request.toolCallId };
        yield* _refresh(
          input,
          request.thread.model,
          client,
          target,
          "step"
        );
      } finally {
        if (request.signal.aborted) {
          await client.cancel(target, studioThread.operationId);
        }
        await input.onSettled?.();
      }
    },

    async *resolveToolApproval(request) {
      await input.beforeExecute?.();
      const client = await _threadClient(input);
      const studioThread = input.getThread();
      if (studioThread.operationId === undefined) {
        throw new Error("The Tool approval does not belong to an active operation.");
      }
      try {
        await client.resolveToolApproval(target, studioThread.operationId, {
          toolCallId: request.toolCallId,
          approved: request.approved,
        });
        if (request.resumeMode === "continue") {
          await client.continue(target, studioThread.operationId, {
            commandId: crypto.randomUUID(),
          });
        } else {
          await _stepCurrent(client, target, studioThread.operationId);
        }
        yield* _refresh(
          input,
          request.thread.model,
          client,
          target,
          request.resumeMode
        );
      } finally {
        if (request.signal.aborted) {
          await client.cancel(target, studioThread.operationId);
        }
        await input.onSettled?.();
      }
    },
  };
}

/** Loads latest Experiment, operation history, and evaluation metadata together. */
async function* _refresh(
  input: Parameters<typeof createProjectThreadExecutionRuntime>[0],
  selectedModel: ModelConfig | undefined,
  client: ThreadClient,
  target: ThreadTarget,
  resumeMode: "step" | "continue"
) {
  const [thread, history, evaluations] = await Promise.all([
    input.client.loadThread(input.threadId),
    input.client.listRunHistory(input.threadId),
    input.client.listEvaluationMetadata(input.threadId),
  ]);
  if (thread === undefined) {
    throw new Error(`Studio Thread "${input.threadId}" was not found.`);
  }
  input.onThread(thread);
  const projected = studioThreadToPlaygroundThread(
    thread,
    history,
    evaluations
  );
  yield {
    type: "thread.updated" as const,
    thread:
      selectedModel === undefined
        ? projected
        : { ...projected, model: structuredClone(selectedModel) },
  };
  if (thread.operationId === undefined) return;
  const snapshot = await client.inspect(target, thread.operationId);
  if (snapshot.approval?.status !== "pending") return;
  yield {
    type: "tool.approval.required" as const,
    toolCallId: snapshot.approval.toolCallId,
    toolName: snapshot.approval.toolName,
    resumeMode,
  };
}

/** Releases exactly the action identified by the current Pi snapshot. */
async function _stepCurrent(
  client: ThreadClient,
  target: ThreadTarget,
  operationId: string,
  known?: Awaited<ReturnType<ThreadClient["inspect"]>>
) {
  const snapshot = known ?? (await client.inspect(target, operationId));
  const action = snapshot.nextAction;
  if (action === undefined) {
    throw new Error(`Pi operation "${operationId}" has no action to Step.`);
  }
  return client.step(target, operationId, {
    commandId: crypto.randomUUID(),
    expectedActionId: action.id,
    kind: action.kind,
  });
}

async function _requireThread(
  input: Parameters<typeof createProjectThreadExecutionRuntime>[0]
): Promise<StudioThread> {
  const thread = await input.client.loadThread(input.threadId);
  if (thread === undefined) {
    throw new Error(`Studio Thread "${input.threadId}" was not found.`);
  }
  input.onThread(thread);
  return thread;
}

/** Maps Studio operation ids to the editor's generic run-history vocabulary. */
function _toEditorEvaluation(evaluation: Evaluation): EvaluationRecord {
  const base = {
    id: evaluation.id,
    leftRunId: evaluation.leftOperationId,
    rightRunId: evaluation.rightOperationId,
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
      criteria: evaluation.rubric.criteria.map((criterion) => ({
        ...criterion,
      })),
    },
    runScores: evaluation.runScores.map((scores) => ({
      runId: scores.operationId,
      scores: scores.scores.map((score) => ({ ...score })),
    })),
  };
}

/** Rewrites the editor's generic Run ids as Pi operation ids. */
function _toStudioEvaluation(evaluation: EvaluationRecord): EvaluationInput {
  const { leftRunId, rightRunId, runScores, rubric, ...metadata } =
    structuredClone(evaluation);
  const base = {
    ...metadata,
    leftOperationId: leftRunId,
    rightOperationId: rightRunId,
  };
  if (rubric === undefined || runScores === undefined) return base;
  return {
    ...base,
    rubric,
    runScores: runScores.map((scores) => ({
      operationId: scores.runId,
      scores: scores.scores,
    })),
  };
}

/** Removes Studio ownership fields from one editor rubric projection. */
function _toEditorRubric(rubric: EvaluationRubric): EvaluationRubricRecord {
  return {
    id: rubric.id,
    name: rubric.name,
    criteria: rubric.criteria.map((criterion) => ({ ...criterion })),
    revision: rubric.revision,
    createdAt: rubric.createdAt,
    updatedAt: rubric.updatedAt,
  };
}

/** Parses the static Pi provider/model string into the editor ModelConfig. */
function _modelConfig(definition: string): ModelConfig | undefined {
  const separator = definition.indexOf("/");
  return separator <= 0 || separator === definition.length - 1
    ? undefined
    : {
        provider: definition.slice(0, separator),
        id: definition.slice(separator + 1),
      };
}

/** Serializes the selected editor model to the Pi provider/model identity. */
function _modelDefinition(model: ModelConfig | undefined): string | undefined {
  return model === undefined ? undefined : `${model.provider}/${model.id}`;
}

/** Deep-compares editor projections without treating shared references specially. */
function _sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => _sameJson(item, right[index]))
    );
  }
  if (!_isRecord(left) || !_isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        _sameJson(left[key], right[key])
    )
  );
}

async function _threadClient(
  input: Parameters<typeof createProjectThreadExecutionRuntime>[0]
): Promise<ThreadClient> {
  if (input.threadClient !== undefined) return input.threadClient;
  const { createThreadClient } = await import("@/client/thread-client");
  return createThreadClient();
}

/** Narrows arbitrary JSON-like values to plain records. */
function _isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
