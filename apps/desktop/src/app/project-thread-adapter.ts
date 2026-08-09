import type { ToolModelOutput } from "@llm-space/agent/tools";
import type {
  Message,
  MessageContent as PlaygroundMessageContent,
  Thread,
  Tool,
  ToolCallOutput,
} from "@llm-space/core";
import type {
  EvaluationRecord,
  EvaluationRubricRecord,
} from "@llm-space/core/thread";
import type {
  ConversationMessage,
  ConversationToolCall,
  MessageContent,
} from "@llm-space/harness";
import type {
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
  Evaluation,
  EvaluationInput,
  EvaluationRubric,
  EvaluationRubricInput,
} from "@llm-space/harness/evaluation";
import type {
  StudioThread,
  StudioThreadDocument,
  StudioRunHistoryEntry,
} from "@llm-space/harness/studio";
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
      tools: thread.document.agent.tools.map(
        (tool): Tool => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })
      ),
      messages: thread.document.conversation.messages.map(_toPlaygroundMessage),
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
          evaluationRubrics: evaluationMetadata.rubrics.map(
            _toPlaygroundRubric
          ),
        }
      : {}),
  };
}

export function playgroundThreadToStudioEvaluationMetadata(
  thread: {
    readonly evaluations?: readonly EvaluationRecord[];
    readonly evaluationRubrics?: readonly EvaluationRubricRecord[];
  }
): StudioEvaluationMetadataInput {
  return {
    evaluations: (thread.evaluations ?? []).map(
      (evaluation): EvaluationInput => structuredClone(evaluation)
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
  const origins = new Map(
    base.document.conversation.messages.map((message) => [
      message.id,
      message.origin,
    ])
  );
  return {
    ...base.document,
    title: thread.title ?? base.document.title,
    conversation: {
      state: base.document.conversation.state,
      messages: (thread.context?.messages ?? []).map((message) =>
        _toConversationMessage(message, origins.get(message.id))
      ),
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
      const receipt = await input.client.run(input.threadId, { fromMessageId });
      const cancel = () => void input.client.cancelRun(receipt.runId);
      request.signal.addEventListener("abort", cancel, { once: true });
      const streaming = new Map<string, string>();
      let [history, evaluationMetadata] = await Promise.all([
        input.client.listRunHistory(input.threadId),
        input.client.listEvaluationMetadata(input.threadId),
      ]);
      try {
        for await (const item of input.client.events(input.threadId, {
          follow: true,
          signal: request.signal,
        })) {
          const event = item.event;
          if (event.type === "message.delta" && event.runId === receipt.runId) {
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
            event.type === "run.completed" &&
            event.runId === receipt.runId
          ) {
            const [latest, nextHistory, nextEvaluationMetadata] = await Promise.all([
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
      } finally {
        request.signal.removeEventListener("abort", cancel);
        await input.onSettled?.();
      }
    },
  };
}

function _toPlaygroundMessage(message: ConversationMessage): Message {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      content: message.content.map(_toPlaygroundContent),
    };
  }
  return {
    id: message.id,
    role: "assistant",
    content: message.content.map(_toPlaygroundContent).filter(
      (content): content is Extract<PlaygroundMessageContent, { type: "text" }> =>
        content.type === "text"
    ),
    ...(message.thinking === undefined ? {} : { thinking: message.thinking }),
    ...(message.toolCalls === undefined
      ? {}
      : { toolCalls: message.toolCalls.map(_toPlaygroundToolCall) }),
  };
}

function _toPlaygroundContent(content: MessageContent): PlaygroundMessageContent {
  return content.type === "text"
    ? content
    : { type: "image", mimeType: content.mimeType, data: content.data };
}

function _toPlaygroundToolCall(call: ConversationToolCall) {
  return {
    id: call.id,
    input: {
      name: call.name,
      arguments: _argumentRecord(call.input),
    },
    ...(call.result === undefined
      ? {}
      : {
          output: {
            content: _toolOutputContent(call.result.output),
            isError: call.result.isError,
          },
        }),
  };
}

function _toConversationMessage(
  message: Message,
  origin: ConversationMessage["origin"]
): ConversationMessage {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      content: message.content.map(_toConversationContent),
      ...(origin === undefined ? {} : { origin }),
    };
  }
  return {
    id: message.id,
    role: "assistant",
    content: message.content.map(_toConversationContent),
    ...(message.thinking === undefined ? {} : { thinking: message.thinking }),
    ...(message.toolCalls === undefined
      ? {}
      : {
          toolCalls: message.toolCalls.map(
            (call): ConversationToolCall => ({
              id: call.id,
              name: call.input.name,
              input: call.input.arguments,
              ...(call.output === undefined
                ? {}
                : {
                    result: {
                      output: _toToolModelOutput(call.output),
                      isError: call.output.isError ?? false,
                    },
                  }),
            })
          ),
        }),
    ...(origin === undefined ? {} : { origin }),
  };
}

function _toConversationContent(
  content: PlaygroundMessageContent
): MessageContent {
  return content.type === "text"
    ? content
    : { type: "image", mimeType: content.mimeType, data: content.data };
}

function _toolOutputContent(output: ToolModelOutput): ToolCallOutput["content"] {
  if (output.type === "text") return [{ type: "text", text: output.value }];
  if (output.type === "json") {
    return [{ type: "text", text: JSON.stringify(output.value) ?? "null" }];
  }
  return output.value.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    if (part.mediaType.startsWith("image/")) {
      return {
        type: "image" as const,
        mimeType: part.mediaType,
        data: part.data.data,
      };
    }
    return {
      type: "text" as const,
      text: part.filename === undefined
        ? `[${part.mediaType} file]`
        : `[${part.mediaType} file: ${part.filename}]`,
    };
  });
}

function _toToolModelOutput(output: ToolCallOutput): ToolModelOutput {
  return {
    type: "content",
    value: output.content.map((content) =>
      content.type === "text"
        ? { type: "text" as const, text: content.text }
        : {
            type: "file" as const,
            data: { type: "data" as const, data: content.data },
            mediaType: content.mimeType,
          }
    ),
  };
}

function _argumentRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
