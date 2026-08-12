import type { AssistantMessage, Thread } from "@llm-space/core";
import type { Run } from "@llm-space/engine";
import {
  playgroundToThread,
  threadToPlaygroundDocument,
  type Playground,
  type SavePlaygroundInput,
} from "@llm-space/studio";
import type { ExternalThreadExecutionRuntime } from "@llm-space/ui/components/thread-playground";

import type { PlaygroundClient } from "@/client/playground-client";

export interface PlaygroundThreadRuntimeOptions {
  readonly client: PlaygroundClient;
  readonly playgroundId: string;
  readonly getPlayground: () => Playground;
  readonly onPlayground: (playground: Playground) => void;
  readonly beforeExecute?: () => void | Promise<void>;
  readonly onSettled?: () => void | Promise<void>;
}

/** Present a durable Studio Playground through the existing editor model. */
export function playgroundToEditorThread(playground: Playground): Thread {
  return playgroundToThread(playground);
}

/**
 * Adapt the editor's Run controls to one durable Engine Run.
 *
 * Step mode executes one model step and optionally all tool calls produced by
 * that model step. ReAct mode delegates the complete loop to Engine Continue.
 * Every follow-up command resumes the same active `runId`.
 */
export function createPlaygroundThreadExecutionRuntime(
  options: PlaygroundThreadRuntimeOptions
): ExternalThreadExecutionRuntime {
  return {
    async *execute(request) {
      await options.beforeExecute?.();
      let runId: string | undefined;
      try {
        let playground = options.getPlayground();
        if (playground.activeRunId === undefined) {
          playground = await options.client.save(
            options.playgroundId,
            _document(request.thread, playground)
          );
          options.onPlayground(playground);
          const fromMessageId =
            request.fromMessageId ??
            request.thread.context?.messages?.at(-1)?.id;
          if (fromMessageId === undefined) {
            throw new Error("A Playground Run requires at least one Message.");
          }
          const receipt = await options.client.run(options.playgroundId, {
            fromMessageId,
            mode: request.reactLoop ? "continue" : "step",
          });
          runId = receipt.runId;
        } else {
          runId = playground.activeRunId;
          if (request.reactLoop) {
            await options.client.continueRun(runId);
          } else {
            await options.client.stepRun(runId);
          }
        }

        let attempt = yield* _streamAttempt(options, runId, request.signal);
        if (
          !request.reactLoop &&
          request.autoRunTools &&
          attempt.status === "paused" &&
          attempt.pause?.step === "model.completed"
        ) {
          // A Step command intentionally executes one tool at a time. Select
          // each pending call explicitly so the UI's "Auto-call tools" mode
          // finishes this tool phase without advancing to the next model turn.
          while (true) {
            playground = options.getPlayground();
            const call = _pendingToolCalls(playground)[0];
            if (call === undefined) break;
            await options.client.stepRun(runId, { toolCallId: call.id });
            attempt = yield* _streamAttempt(options, runId, request.signal);
            if (attempt.status !== "paused") break;
          }
        }
      } finally {
        if (request.signal.aborted && runId !== undefined) {
          await options.client.cancelRun(runId);
        }
        await options.onSettled?.();
      }
    },

    async *executeToolCall(request) {
      await options.beforeExecute?.();
      const playground = options.getPlayground();
      const runId = playground.activeRunId;
      if (runId === undefined) {
        throw new Error("The tool call does not belong to an active Run.");
      }
      const ownsCall = playground.conversation.messages.some(
        (message) =>
          message.id === request.messageId &&
          message.role === "assistant" &&
          message.toolCalls?.some(
            (call) =>
              call.id === request.toolCallId && call.output === undefined
          )
      );
      if (!ownsCall) {
        throw new Error(
          `Tool call "${request.toolCallId}" is not pending on the active Playground Run.`
        );
      }
      try {
        await options.client.stepRun(runId, {
          toolCallId: request.toolCallId,
        });
        yield* _streamAttempt(options, runId, request.signal);
      } finally {
        if (request.signal.aborted) await options.client.cancelRun(runId);
        await options.onSettled?.();
      }
    },
  };
}

/** Preserve Agent state because the editor Thread intentionally does not own it. */
function _document(
  thread: Thread,
  playground: Playground
): SavePlaygroundInput {
  const document = threadToPlaygroundDocument(
    thread,
    playground.conversation.state
  );
  return {
    ...document,
  };
}

async function* _streamAttempt(
  options: PlaygroundThreadRuntimeOptions,
  runId: string,
  signal: AbortSignal
): AsyncGenerator<
  | { readonly type: "thread.updated"; readonly thread: Thread }
  | {
      readonly type: "message.delta";
      readonly message: AssistantMessage;
    },
  Run
> {
  const streaming = new Map<string, AssistantMessage>();
  for await (const frame of options.client.streamRun(runId, { signal })) {
    if (frame.type === "snapshot") {
      for (const output of frame.outputs) {
        streaming.set(output.message.id, structuredClone(output.message));
        if (output.status === "streaming") {
          yield { type: "message.delta", message: output.message };
        }
      }
      if (_settled(frame.run)) {
        yield* _refresh(options);
        return _terminalResult(frame.run);
      }
      continue;
    }
    const event = frame.event;
    if (event.type === "message.delta") {
      const current = _streamingMessage(streaming, event.messageId);
      const next = {
        ...current,
        content: [
          { type: "text" as const, text: _text(current) + event.delta },
        ],
      };
      streaming.set(event.messageId, next);
      yield { type: "message.delta", message: next };
    } else if (event.type === "thinking.delta") {
      const current = _streamingMessage(streaming, event.messageId);
      const next = {
        ...current,
        thinking: `${current.thinking ?? ""}${event.delta}`,
      };
      streaming.set(event.messageId, next);
      yield { type: "message.delta", message: next };
    } else if (event.type === "message.completed") {
      streaming.set(event.message.id, structuredClone(event.message));
      yield {
        type: "thread.updated",
        thread: _withAssistant(options.getPlayground(), event.message),
      };
    } else if (
      event.type === "tool.updated" ||
      event.type === "tool.completed"
    ) {
      streaming.set(event.message.id, structuredClone(event.message));
      yield {
        type: "thread.updated",
        thread: _withAssistant(options.getPlayground(), event.message),
      };
    } else if (event.type === "checkpoint.committed") {
      yield* _refresh(options);
    } else if (event.type === "run.updated" && _settled(event.run)) {
      yield* _refresh(options);
      return _terminalResult(event.run);
    }
  }
  throw new Error(`Run "${runId}" stream ended before it settled.`);
}

/** Failed/interrupted Runs are terminal in storage but errors in the UI command. */
function _terminalResult(run: Run): Run {
  if (run.status === "failed" || run.status === "interrupted") {
    throw new Error(run.error?.message ?? `Run ended as ${run.status}.`);
  }
  return run;
}

async function* _refresh(
  options: PlaygroundThreadRuntimeOptions
): AsyncGenerator<{
  readonly type: "thread.updated";
  readonly thread: Thread;
}> {
  const latest = await options.client.load(options.playgroundId);
  if (latest === undefined) {
    throw new Error(`Playground "${options.playgroundId}" was not found.`);
  }
  options.onPlayground(latest);
  yield { type: "thread.updated", thread: playgroundToEditorThread(latest) };
}

function _withAssistant(
  playground: Playground,
  assistant: AssistantMessage
): Thread {
  const thread = playgroundToEditorThread(playground);
  const messages = [...(thread.context?.messages ?? [])];
  const index = messages.findIndex((message) => message.id === assistant.id);
  if (index === -1) messages.push(structuredClone(assistant));
  else messages[index] = structuredClone(assistant);
  return {
    ...thread,
    context: { ...thread.context, messages },
  };
}

function _pendingToolCalls(playground: Playground) {
  const last = playground.conversation.messages.at(-1);
  return last?.role === "assistant"
    ? (last.toolCalls ?? []).filter((call) => call.output === undefined)
    : [];
}

function _streamingMessage(
  messages: Map<string, AssistantMessage>,
  messageId: string
): AssistantMessage {
  return (
    messages.get(messageId) ?? {
      id: messageId,
      role: "assistant",
      content: [],
    }
  );
}

function _text(message: AssistantMessage): string {
  return message.content.map((item) => item.text).join("");
}

function _settled(run: Run): boolean {
  return (
    run.status === "paused" ||
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "interrupted"
  );
}
