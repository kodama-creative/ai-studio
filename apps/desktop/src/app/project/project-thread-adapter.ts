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

import { createThreadExecutionRuntime } from "../thread-execution-runtime";

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
  readonly beforeAdmission?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}): ExternalThreadExecutionRuntime {
  const target: ThreadTarget = {
    kind: "experiment",
    projectId: input.projectId,
    experimentId: input.threadId,
  };
  return createThreadExecutionRuntime({
    productName: "Studio",
    target,
    getClient: () => _threadClient(input),
    currentOperationId: () => input.getThread().operationId,
    async persist(thread) {
      const saved = await input.client.saveDocument(
        input.threadId,
        playgroundThreadToStudioDocument(thread, input.getThread())
      );
      input.onThread(saved);
    },
    async refresh(source) {
      const [thread, history, evaluations] = await Promise.all([
        _requireThread(input),
        input.client.listRunHistory(input.threadId),
        input.client.listEvaluationMetadata(input.threadId),
      ]);
      const projected = studioThreadToPlaygroundThread(
        thread,
        history,
        evaluations
      );
      return {
        operationId: thread.operationId,
        thread:
          source.model === undefined
            ? projected
            : { ...projected, model: structuredClone(source.model) },
      };
    },
    runOverrides(thread) {
      const modelOverride = _modelDefinition(thread.model);
      return modelOverride === undefined ? {} : { modelOverride };
    },
    beforeAdmission: input.beforeAdmission,
    onSettled: input.onSettled,
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
