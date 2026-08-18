/* eslint-disable @typescript-eslint/unbound-method */
import {
  createAcpSessionProjection,
  reduceAcpSessionNotification,
  type AcpSessionProjection,
  type ContentBlock,
  type UpdateSessionNotification,
} from "@llm-space/acp/protocol";
import {
  AssistantMessage,
  getMessageText,
  getToolDisplayName,
  getToolKey,
  messagesFromSharedSessionUpdates,
  Message,
  normalizeThread,
  Tool as ToolSchema,
  uuid,
  type MessageContent,
  type ModelConfig,
  type ModelConfigParams,
  type SharedSessionUpdate,
  type Thread,
  type ThreadVariable,
  type ThreadVariableVariants,
  type ThreadVariables,
  type Tool,
  type ToolCall,
  type ToolCallOutput,
  type UserMessage,
} from "@llm-space/core";
import {
  createMessagePromptVariablePlaceKey,
  createToolResultPromptVariablePlaceKey,
  DEFAULT_VARIABLE_VARIANT_NAME,
  ensureThreadVariableState,
  getToolCallOutputText,
  getToolResultText,
  normalizeEvaluationRubrics,
  normalizeEvaluations,
  normalizePromptVariableState,
  normalizeRunHistory,
  removePromptVariableSnapshotNames,
  removePromptVariableSnapshotPlaces,
  replaceThreadPromptVariableReferences,
  SYSTEM_PROMPT_PLACE_KEY,
  upsertEvaluation,
  upsertEvaluationRubric,
  withRunMetadata,
  type EvaluationRecord,
  type EvaluationRubricInput,
  type EvaluationRubricRecord,
  type EvaluationRubricSnapshot,
  type EvaluationRunScores,
  type RunSnapshot,
} from "@llm-space/core/thread";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import { Compile } from "typebox/compile";
import { createStore, useStore, type StoreApi } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/shallow";

import { getRunValidationIssue } from "./run-validation";
import type { RunValidationIssue } from "./run-validation-issue";
import {
  createInitialHistory,
  recordSnapshot,
  redo as redoHistory,
  undo as undoHistory,
  type ChangeHistory,
} from "./thread-history";

const toolValidator = Compile(ToolSchema);

function _asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export type ThreadStoreStatus = "idle" | "preparing" | "running";

export interface AcpSessionExecutionRuntime {
  readonly sessionId: string;
  updates(input: {
    readonly afterCursor: number;
    readonly signal: AbortSignal;
  }): AsyncIterable<UpdateSessionNotification>;
  prompt(input: {
    readonly prompt: readonly ContentBlock[];
    readonly fromMessageId: string;
    readonly mode: "step" | "turn" | "continue";
    readonly thread: Thread;
    readonly signal: AbortSignal;
  }): Promise<void>;
  step(input: AcpRuntimeAction): Promise<void>;
  turn(input: AcpRuntimeAction): Promise<void>;
  continue(input: {
    readonly operationId: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
  requestPermission(input: {
    readonly operationId: string;
    readonly expectedActionId: string;
    readonly toolCallId: string;
    readonly optionId: "allow_once" | "reject_once";
    readonly resumeMode: "step" | "continue";
    readonly signal: AbortSignal;
  }): Promise<void>;
  cancel(): Promise<void>;
}

export interface AcpRuntimeAction {
  readonly operationId: string;
  readonly expectedActionId: string;
  readonly kind: "model" | "tool";
  readonly signal: AbortSignal;
}

export interface PendingToolApproval {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly resumeMode: "step" | "continue";
}

export interface ThreadRunMetadata {
  readonly runHistory: readonly RunSnapshot[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly evaluationRubrics: readonly EvaluationRubricRecord[];
}

export interface ThreadState {
  thread: Thread;
  /** The only execution/transcript state for Pi-backed hosts. */
  acpSession: AcpSessionProjection | null;
  streamingMessage: AssistantMessage | null;
  status: ThreadStoreStatus;
  abortController: AbortController | null;
  activeRunId: string | null;
  /** Auto-executing tool calls for in-flight UI feedback; never persisted. */
  executingToolCallIds: string[];
  /** Durable Runtime suspension currently awaiting a user decision. */
  pendingToolApproval: PendingToolApproval | null;
  /** Runtime-owned tool outputs are durable and cannot be edited locally. */
  toolCallOutputsReadonly: boolean;
  /** The host can execute function-tool calls that are only stubs in the UI model. */
  externalToolExecutionAvailable: boolean;
  collapsedMessageIds: string[];
  runValidationIssue: RunValidationIssue | null;
  /**
   * Id of the message whose editor should grab focus on mount — set only by
   * append/insert. Every other editor mounts with autoFocus off so opening a
   * thread doesn't thrash focus/scroll across N editors. Store-only; never
   * serialized into the thread.
   */
  autoFocusMessageId: string | null;
  changeHistory: ChangeHistory;
  /** Thread snapshot + completion time after each run; most recent last. */
  runHistory: RunSnapshot[];
  /** Manual verdicts comparing durable run snapshots. */
  evaluations: EvaluationRecord[];
  /** Reusable manual evaluation rubrics owned by this thread. */
  evaluationRubrics: EvaluationRubricRecord[];

  run(fromMessageId?: string): Promise<void>;
  /** Execute one host-owned durable Tool Step when using an external runtime. */
  runExternalToolCall(messageId: string, toolCallId: string): Promise<boolean>;
  /** Approve/deny the current Runtime-owned suspension and resume execution. */
  resolveToolApproval(approved: boolean): Promise<boolean>;
  resolveRunValidationIssue(): void;
  undo(): void;
  redo(): void;
  restoreThread(thread: Thread): void;
  removeRun(run: RunSnapshot): void;
  saveEvaluation(input: {
    leftRunId: string;
    rightRunId: string;
    verdict: EvaluationRecord["verdict"];
    note?: string;
    rubric?: EvaluationRubricSnapshot;
    runScores?: EvaluationRunScores[];
  }): boolean;
  removeEvaluation(evaluation: EvaluationRecord): void;
  saveEvaluationRubric(
    input: EvaluationRubricInput
  ): EvaluationRubricRecord | null;
  removeEvaluationRubric(id: string): boolean;
  appendMessage(): void;
  insertMessageBefore(beforeMessageId: string): void;
  moveMessage(fromIndex: number, toIndex: number): void;
  removeMessage(id: string): void;
  updateSystemPrompt(systemPrompt: string): void;
  updatePromptVariable(name: string, variable: ThreadVariable): void;
  removePromptVariable(name: string): void;
  renamePromptVariable(oldName: string, newName: string): boolean;
  addCustomVariable(name: string, value?: string): boolean;
  updateCustomVariable(name: string, value: string): void;
  renameCustomVariable(oldName: string, newName: string): boolean;
  removeCustomVariable(name: string): void;
  updateTitle(title: string | undefined): void;
  syncTitle(title: string): void;
  updateModelParams(params: Partial<ModelConfigParams>): void;
  updateModel(model: Pick<ModelConfig, "id" | "provider">): void;
  updateMessageTextContent(id: string, text: string): void;
  addMessageImageContent(id: string, mimeType: string, data: string): void;
  removeMessageImageContent(id: string, contentIndex: number): void;
  /** Replace editable tool-result text while retaining structured images. */
  updateToolCallOutputTextContent(
    messageId: string,
    toolCallId: string,
    text: string,
    isError?: boolean
  ): void;
  /** Replace the complete model-facing output produced by a tool execution. */
  updateToolCallOutputContent(
    messageId: string,
    toolCallId: string,
    content: ToolCallOutput["content"],
    isError?: boolean
  ): void;
  addTool(tool: Tool): boolean;
  updateTool(name: string, tool: Tool): boolean;
  removeTool(name: string): void;
  toggleMessageRole(id: string): void;
  toggleMessageCollapsed(id: string): void;
  abort(): void;
}

export type ThreadStore = StoreApi<ThreadState>;

export function createThreadStore(
  initialThread: Thread,
  options: {
    /** ACP is the only execution protocol for an interactive host. */
    executionRuntime?: AcpSessionExecutionRuntime;
    /** Persist host-owned Run/Evaluation resources after explicit metadata edits. */
    onRunMetadataChange?: (metadata: ThreadRunMetadata) => void;
    /**
     * Resolve the model a run/edit should use given the thread's saved model:
     * the saved model when still available, else the user's default, else the
     * first available model (`null` when none are configured). Supplied by the
     * UI, which holds the live provider list and default. Catches both threads
     * with no model and threads with a stale (removed) reference.
     */
    resolveModel?: (
      saved: ModelConfig | null | undefined
    ) => ModelConfig | null;
    /**
     * Whether a run should automatically execute a model turn's pending tool
     * calls (instead of waiting for the user to click "Call tools"). Read fresh
     * at run time. On its own it runs tools once and stops; combined with
     * {@link getReactLoop} it keeps looping. Defaults to `false`.
     */
    getAutoRunTools?: () => boolean;
    /**
     * Whether the ReAct loop is enabled: keep alternating model turn ⇄ tool
     * execution until the model stops calling tools. Implies auto-running tools.
     * Read fresh at run time. Defaults to `false`.
     */
    getReactLoop?: () => boolean;
  } = {}
): ThreadStore {
  const normalizedInputThread = ensureThreadVariableState(
    normalizeThread(initialThread)
  );
  const initialRunHistory = normalizeRunHistory(
    normalizedInputThread.runHistory
  );
  const initialEvaluations = normalizeEvaluations(
    normalizedInputThread.evaluations,
    initialRunHistory
  );
  const initialEvaluationRubrics = normalizeEvaluationRubrics(
    normalizedInputThread.evaluationRubrics
  );
  const normalizedInitialThread = withRunMetadata(normalizedInputThread, {
    runHistory: initialRunHistory,
    evaluations: initialEvaluations,
    evaluationRubrics: initialEvaluationRubrics,
  });

  return createStore<ThreadState>()(
    subscribeWithSelector((set, get) => {
      // --- internal helpers ---------------------------------------------------

      let stopActiveRun: (() => void) | null = null;

      const patchThread = (partial: Partial<Thread>) => {
        const next = { ...get().thread, ...partial };
        set({ thread: next });
        // Streaming changes are folded into a single record by run(); skip them
        // here so each chunk doesn't become its own undo step.
        if (get().status !== "running") {
          set({ changeHistory: recordSnapshot(get().changeHistory, next) });
        }
      };

      const patchContext = (partial: Partial<Thread["context"]>) => {
        patchThread({ context: { ...get().thread.context, ...partial } });
      };

      const publishRunMetadata = (
        runHistory: RunSnapshot[],
        evaluations: EvaluationRecord[],
        evaluationRubrics: EvaluationRubricRecord[]
      ) => {
        options.onRunMetadataChange?.({
          runHistory,
          evaluations,
          evaluationRubrics,
        });
      };

      const getVariableState = () =>
        normalizePromptVariableState(get().thread.context);

      const setVariableState = (
        variables: ThreadVariables,
        variableVariants: ThreadVariableVariants,
        systemPrompt = get().thread.context?.systemPrompt,
        // Variable names whose captured snapshot values must be dropped so their
        // existing references re-render with the edited value (see below).
        invalidateSnapshotNames?: Iterable<string>
      ) => {
        const partial: Partial<Thread["context"]> = {
          variables,
          variableVariants,
          systemPrompt,
        };
        if (invalidateSnapshotNames) {
          partial.snapshot = removePromptVariableSnapshotNames(
            get().thread.context?.snapshot,
            invalidateSnapshotNames
          );
        }
        patchContext(partial);
      };

      const defaultCustomValues = (variableVariants: ThreadVariableVariants) =>
        variableVariants.variants[DEFAULT_VARIABLE_VARIANT_NAME] ?? {};

      const customVariableNames = (variableVariants: ThreadVariableVariants) =>
        new Set(Object.keys(defaultCustomValues(variableVariants)));

      const withDefaultCustomValues = (
        values: Record<string, string>
      ): ThreadVariableVariants => ({
        active: DEFAULT_VARIABLE_VARIANT_NAME,
        variants: { [DEFAULT_VARIABLE_VARIANT_NAME]: values },
      });

      /*
       * Custom variables now expose one explicit default set, so every edit
       * rewrites the state to that single bucket.
       */
      const setDefaultCustomValues = (
        variables: ThreadVariables,
        values: Record<string, string>,
        systemPrompt = get().thread.context?.systemPrompt,
        invalidateSnapshotNames?: Iterable<string>
      ) => {
        setVariableState(
          variables,
          withDefaultCustomValues(values),
          systemPrompt,
          invalidateSnapshotNames
        );
      };

      const allCustomVariableNames = (
        variableVariants: ThreadVariableVariants
      ) => {
        const names = new Set<string>();
        for (const values of Object.values(variableVariants.variants)) {
          for (const name of Object.keys(values)) {
            names.add(name);
          }
        }
        return names;
      };

      const showDuplicateVariableName = (name: string) => {
        toast.error("Variable name already exists", {
          description: `"${name}" is already used by another variable.`,
        });
      };

      const reconcileRunValidationIssue = (messages: Message[]) => {
        const current = get().runValidationIssue;
        if (!current) {
          return;
        }
        const next = getRunValidationIssue(messages);
        if (
          next?.messageId !== current.messageId ||
          next?.code !== current.code
        ) {
          set({ runValidationIssue: null });
        }
      };

      const setMessages = (messages: Message[]) => {
        patchContext({ messages });
        reconcileRunValidationIssue(messages);
      };

      /** Replace the messages array; skips the update if nothing changed. */
      const updateMessages = (updater: (messages: Message[]) => Message[]) => {
        const messages = get().thread.context?.messages ?? [];
        const next = updater(messages);
        if (next !== messages) {
          setMessages(next);
        }
      };

      const getMessage = (id: string) =>
        (get().thread.context?.messages ?? []).find(
          (message) => message.id === id
        );

      /** Replace a single message by id; no-op (same array ref) if not found. */
      const updateMessage = (
        id: string,
        updater: (message: Message) => Message
      ) => {
        updateMessages((messages) => {
          let changed = false;
          const next = messages.map((message) => {
            if (message.id !== id) {
              return message;
            }
            changed = true;
            return updater(message);
          });
          return changed ? next : messages;
        });
      };

      /**
       * Replace one tool result while preserving copy-on-write message updates
       * and invalidating only the rendered text snapshot affected by the edit.
       */
      const setToolCallOutput = (
        messageId: string,
        toolCallId: string,
        createOutput: (toolCall: ToolCall) => ToolCallOutput | undefined
      ) => {
        const context = get().thread.context ?? {};
        const messages = context.messages ?? [];
        let changed = false;
        let textChanged = false;
        const nextMessages = messages.map((message) => {
          if (message.id !== messageId || message.role !== "assistant") {
            return message;
          }
          let messageChanged = false;
          const toolCalls = message.toolCalls?.map((toolCall) => {
            if (toolCall.id !== toolCallId) {
              return toolCall;
            }
            const output = createOutput(toolCall);
            if (!output) {
              return toolCall;
            }
            changed = true;
            messageChanged = true;
            textChanged ||=
              getToolCallOutputText(toolCall) !==
              getToolResultText(output.content);
            return { ...toolCall, output };
          });
          return messageChanged ? { ...message, toolCalls } : message;
        });
        if (!changed) {
          return;
        }
        patchContext({
          messages: nextMessages,
          ...(textChanged
            ? {
                snapshot: removePromptVariableSnapshotPlaces(context.snapshot, [
                  createToolResultPromptVariablePlaceKey(messageId, toolCallId),
                ]),
              }
            : {}),
        });
      };

      const createUserMessage = (): UserMessage => ({
        id: uuid(),
        role: "user",
        content: [{ type: "text", text: "" }],
      });

      /** Validate a tool against the schema, toasting the first errors. */
      const validateTool = (tool: Tool): boolean => {
        if (!toolValidator.Check(tool)) {
          const errors = [...toolValidator.Errors(tool)];
          toast.error("Error", {
            description:
              errors.map((e) => e.message).join(", ") || "Invalid tool",
          });
          return false;
        }
        return true;
      };

      /** Keep image contents before any other content, preserving order. */
      const partitionImagesFirst = (content: UserMessage["content"]) => [
        ...content.filter((c) => c.type === "image"),
        ...content.filter((c) => c.type !== "image"),
      ];

      const applyAcpNotification = (
        notification: UpdateSessionNotification
      ): void => {
        const current =
          get().acpSession ??
          createAcpSessionProjection(notification.sessionId);
        const projection = reduceAcpSessionNotification(current, notification);
        if (
          notification.update.sessionUpdate === "agent_message_chunk" ||
          notification.update.sessionUpdate === "agent_thought_chunk"
        ) {
          const messageId = notification.update.messageId;
          if (typeof messageId !== "string" || messageId.length === 0) {
            throw new Error("ACP message chunk requires a non-empty messageId.");
          }
          set({
            acpSession: projection,
            streamingMessage: _acpStreamingAssistant(projection, messageId),
          });
          return;
        }
        const thread = _acpProjectionToThread(projection, get().thread);
        const approval = _acpApproval(projection);
        set({
          acpSession: projection,
          thread,
          ...(projection.state === "running" ? { status: "running" } : {}),
          streamingMessage: null,
          executingToolCallIds: projection.toolCallOrder.filter(
            (id) => projection.toolCalls[id]?.status === "in_progress"
          ),
          pendingToolApproval:
            approval === undefined
              ? null
              : {
                  toolCallId: approval.toolCallId,
                  toolName: approval.toolName,
                  resumeMode: "step",
                },
        });
      };

      const executeAcpCommand = async (
        command: (
          runtime: AcpSessionExecutionRuntime,
          signal: AbortSignal
        ) => Promise<void>,
        signal: AbortSignal
      ): Promise<void> => {
        const runtime = options.executionRuntime;
        if (runtime === undefined) {
          throw new Error("This Thread does not have an ACP Session runtime.");
        }
        const streamController = new AbortController();
        signal.addEventListener("abort", () => streamController.abort(), {
          once: true,
        });
        const initialCursor = get().acpSession?.cursor ?? 0;
        const iterator = runtime
          .updates({ afterCursor: initialCursor, signal: streamController.signal })
          [Symbol.asyncIterator]();
        try {
          // Drain the replay frame through its state barrier before issuing a
          // mutation, so the command always acts on a complete projection.
          while (!signal.aborted) {
            const next = await iterator.next();
            if (next.done) {
              throw new Error("ACP Session update stream closed during resume.");
            }
            applyAcpNotification(next.value);
            if (next.value.update.sessionUpdate === "state_update") break;
          }
          const baseline = get().acpSession?.cursor ?? initialCursor;
          let latestStateCursor = baseline;
          let wake: (() => void) | undefined;
          let pumpFailure: unknown;
          const pump = (async () => {
            try {
              while (!streamController.signal.aborted) {
                const next = await iterator.next();
                if (next.done) break;
                applyAcpNotification(next.value);
                if (next.value.update.sessionUpdate === "state_update") {
                  latestStateCursor = get().acpSession?.cursor ?? baseline;
                  wake?.();
                  wake = undefined;
                }
              }
            } catch (error) {
              if (!streamController.signal.aborted) pumpFailure = error;
              wake?.();
              wake = undefined;
            }
          })();
          await command(runtime, signal);
          while (latestStateCursor <= baseline && !signal.aborted) {
            if (pumpFailure !== undefined) throw _asError(pumpFailure);
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          if (pumpFailure !== undefined) throw _asError(pumpFailure);
          streamController.abort();
          await pump;
        } finally {
          streamController.abort();
          await iterator.return?.();
        }
      };

      // --- store --------------------------------------------------------------

      return {
        thread: normalizedInitialThread,
        acpSession:
          options.executionRuntime === undefined
            ? null
            : createAcpSessionProjection(options.executionRuntime.sessionId),
        streamingMessage: null,
        status: "idle",
        abortController: null,
        activeRunId: null,
        executingToolCallIds: [],
        pendingToolApproval: null,
        toolCallOutputsReadonly: options.executionRuntime !== undefined,
        externalToolExecutionAvailable: options.executionRuntime !== undefined,
        collapsedMessageIds: [],
        runValidationIssue: null,
        autoFocusMessageId: null,
        changeHistory: createInitialHistory(normalizedInitialThread),
        runHistory: initialRunHistory,
        evaluations: initialEvaluations,
        evaluationRubrics: initialEvaluationRubrics,

        appendMessage() {
          const message = createUserMessage();
          updateMessages((messages) => [...messages, message]);
          set({ autoFocusMessageId: message.id });
          return message.id;
        },
        resolveRunValidationIssue() {
          const resolution = get().runValidationIssue?.resolution;
          if (resolution?.type === "appendUserMessage") {
            get().appendMessage();
          }
        },
        insertMessageBefore(beforeMessageId: string) {
          const messages = get().thread.context?.messages ?? [];
          const index = messages.findIndex((m) => m.id === beforeMessageId);
          if (index === -1) {
            return;
          }
          const message = createUserMessage();
          setMessages([
            ...messages.slice(0, index),
            message,
            ...messages.slice(index),
          ]);
          set({ autoFocusMessageId: message.id });
        },
        moveMessage(fromIndex: number, toIndex: number) {
          updateMessages((messages) => {
            if (
              fromIndex === toIndex ||
              fromIndex < 0 ||
              toIndex < 0 ||
              fromIndex >= messages.length ||
              toIndex >= messages.length
            ) {
              return messages;
            }
            const next = [...messages];
            const [moved] = next.splice(fromIndex, 1);
            if (!moved) {
              return messages;
            }
            next.splice(toIndex, 0, moved);
            return next;
          });
        },
        removeMessage(id: string) {
          updateMessages((messages) => messages.filter((m) => m.id !== id));
          const { collapsedMessageIds } = get();
          if (collapsedMessageIds.includes(id)) {
            set({
              collapsedMessageIds: collapsedMessageIds.filter(
                (cid) => cid !== id
              ),
            });
          }
        },
        updateSystemPrompt(systemPrompt: string) {
          const context = get().thread.context ?? {};
          if (context.systemPrompt === systemPrompt) {
            return;
          }
          patchContext({
            systemPrompt,
            snapshot: removePromptVariableSnapshotPlaces(context.snapshot, [
              SYSTEM_PROMPT_PLACE_KEY,
            ]),
          });
        },
        updatePromptVariable(name, variable) {
          const { variables, variableVariants } = getVariableState();
          setVariableState(
            { ...variables, [name]: variable },
            variableVariants,
            undefined,
            [name]
          );
        },
        removePromptVariable(name) {
          const { variables, variableVariants } = getVariableState();
          const nextVariables = { ...variables };
          delete nextVariables[name];
          setVariableState(nextVariables, variableVariants, undefined, [name]);
        },
        renamePromptVariable(oldName, newName) {
          if (oldName === newName) {
            return true;
          }
          const { variables, variableVariants } = getVariableState();
          if (
            Object.prototype.hasOwnProperty.call(variables, newName) ||
            allCustomVariableNames(variableVariants).has(newName)
          ) {
            showDuplicateVariableName(newName);
            return false;
          }
          const variable = variables[oldName];
          if (!variable) {
            return false;
          }
          const nextVariables = { ...variables };
          delete nextVariables[oldName];
          nextVariables[newName] = variable;
          patchThread({
            context: replaceThreadPromptVariableReferences(
              {
                ...(get().thread.context ?? {}),
                variables: nextVariables,
                variableVariants,
              },
              oldName,
              newName
            ),
          });
          return true;
        },
        addCustomVariable(name, value = "") {
          const { variables, variableVariants } = getVariableState();
          const customValues = defaultCustomValues(variableVariants);
          if (Object.prototype.hasOwnProperty.call(variables, name)) {
            showDuplicateVariableName(name);
            return false;
          }
          if (Object.prototype.hasOwnProperty.call(customValues, name)) {
            showDuplicateVariableName(name);
            return false;
          }
          setDefaultCustomValues(
            variables,
            { ...customValues, [name]: value },
            undefined,
            [name]
          );
          return true;
        },
        updateCustomVariable(name, value) {
          const { variables, variableVariants } = getVariableState();
          const customValues = defaultCustomValues(variableVariants);
          setDefaultCustomValues(
            variables,
            { ...customValues, [name]: value },
            undefined,
            [name]
          );
        },
        renameCustomVariable(oldName, newName) {
          if (oldName === newName) {
            return true;
          }
          const { variables, variableVariants } = getVariableState();
          const existingCustomNames = customVariableNames(variableVariants);
          existingCustomNames.delete(oldName);
          if (
            Object.prototype.hasOwnProperty.call(variables, newName) ||
            existingCustomNames.has(newName)
          ) {
            showDuplicateVariableName(newName);
            return false;
          }
          const customValues = defaultCustomValues(variableVariants);
          if (!Object.prototype.hasOwnProperty.call(customValues, oldName)) {
            return false;
          }
          const nextValues = { ...customValues };
          const value = nextValues[oldName];
          delete nextValues[oldName];
          nextValues[newName] = value;
          patchThread({
            context: replaceThreadPromptVariableReferences(
              {
                ...(get().thread.context ?? {}),
                variables,
                variableVariants: withDefaultCustomValues(nextValues),
              },
              oldName,
              newName
            ),
          });
          return true;
        },
        removeCustomVariable(name) {
          const { variables, variableVariants } = getVariableState();
          const nextValues = { ...defaultCustomValues(variableVariants) };
          delete nextValues[name];
          setDefaultCustomValues(variables, nextValues, undefined, [name]);
        },
        updateTitle(title: string | undefined) {
          patchThread({ title });
        },
        syncTitle(title: string) {
          const current = get().thread;
          if (current.title === title) {
            return;
          }
          set({ thread: { ...current, title } });
        },
        updateModelParams(params: Partial<ModelConfigParams>) {
          // Materialize the model on explicit param edits: resolve the thread's
          // model (falling back when it has none, or a stale reference).
          const base = options.resolveModel?.(get().thread.model);
          if (!base) {
            return;
          }
          patchThread({
            model: { ...base, params: { ...base.params, ...params } },
          });
        },
        updateModel(model: Pick<ModelConfig, "id" | "provider">) {
          const current = get().thread.model;
          patchThread({
            model: { ...current, provider: model.provider, id: model.id },
          });
        },
        updateMessageTextContent(id: string, text: string) {
          const context = get().thread.context ?? {};
          const messages = context.messages ?? [];
          let changed = false;
          const nextMessages = messages.map((message) => {
            if (message.id !== id) {
              return message;
            }
            if (getMessageText(message) === text) {
              return message;
            }
            changed = true;
            const content = [...message.content] as MessageContent[];
            const index = content.findIndex((c) => c.type === "text");
            if (index === -1) {
              content.push({ type: "text", text });
            } else {
              content[index] = { type: "text", text };
            }
            return { ...message, content } as Message;
          });
          if (!changed) {
            return;
          }
          patchContext({
            messages: nextMessages,
            snapshot: removePromptVariableSnapshotPlaces(context.snapshot, [
              createMessagePromptVariablePlaceKey(id),
            ]),
          });
        },
        addMessageImageContent(id: string, mimeType: string, data: string) {
          if (getMessage(id)?.role !== "user") {
            return;
          }
          updateMessage(id, (message) => {
            const user = message as UserMessage;
            return {
              ...user,
              content: partitionImagesFirst([
                ...user.content,
                { type: "image", mimeType, data },
              ]),
            };
          });
        },
        removeMessageImageContent(id: string, contentIndex: number) {
          const message = getMessage(id);
          if (message?.role !== "user") {
            return;
          }
          if (message.content[contentIndex]?.type !== "image") {
            return;
          }
          updateMessage(id, (m) => {
            const user = m as UserMessage;
            return {
              ...user,
              content: partitionImagesFirst(
                user.content.filter((_, index) => index !== contentIndex)
              ),
            };
          });
        },
        addTool(tool) {
          const { thread } = get();
          const toolKey = getToolKey(tool);
          if (thread.context?.tools?.some((t) => getToolKey(t) === toolKey)) {
            toast.error("Error", {
              description: `Tool "${getToolDisplayName(tool)}" already exists`,
            });
            return false;
          }
          if (!validateTool(tool)) {
            return false;
          }
          patchContext({ tools: [...(thread.context?.tools ?? []), tool] });
          return true;
        },
        updateTool(name, tool) {
          const tools = get().thread.context?.tools ?? [];
          const index = tools.findIndex((t) => getToolKey(t) === name);
          if (index === -1) {
            return false;
          }
          if (!validateTool(tool)) {
            return false;
          }
          const nextKey = getToolKey(tool);
          if (
            nextKey !== name &&
            tools.some((t) => getToolKey(t) === nextKey)
          ) {
            toast.error("Error", {
              description: `Tool "${getToolDisplayName(tool)}" already exists`,
            });
            return false;
          }
          const next = [...tools];
          next[index] = tool;
          patchContext({ tools: next });
          return true;
        },
        removeTool(name) {
          patchContext({
            tools: get().thread.context?.tools?.filter(
              (tool) => getToolKey(tool) !== name
            ),
          });
        },
        updateToolCallOutputTextContent(messageId, toolCallId, text, isError) {
          if (get().toolCallOutputsReadonly) return;
          setToolCallOutput(messageId, toolCallId, (toolCall) => {
            const currentText = getToolCallOutputText(toolCall);
            const nextIsError = isError ?? toolCall.output?.isError;
            if (
              currentText === text &&
              toolCall.output?.isError === nextIsError
            ) {
              return undefined;
            }
            return {
              content: [
                { type: "text", text },
                ...(toolCall.output?.content.filter(
                  (item) => item.type === "image"
                ) ?? []),
              ],
              isError: nextIsError,
            };
          });
        },
        updateToolCallOutputContent(messageId, toolCallId, content, isError) {
          if (get().toolCallOutputsReadonly) return;
          setToolCallOutput(messageId, toolCallId, (toolCall) => {
            const nextIsError = isError ?? toolCall.output?.isError;
            if (
              toolCall.output?.content === content &&
              toolCall.output?.isError === nextIsError
            ) {
              return undefined;
            }
            return { content, isError: nextIsError };
          });
        },
        toggleMessageRole(id: string) {
          updateMessage(
            id,
            (message) =>
              ({
                ...message,
                role: message.role === "user" ? "assistant" : "user",
              }) as Message
          );
        },
        toggleMessageCollapsed(id: string) {
          const { collapsedMessageIds } = get();
          set({
            collapsedMessageIds: collapsedMessageIds.includes(id)
              ? collapsedMessageIds.filter((i) => i !== id)
              : [...collapsedMessageIds, id],
          });
        },
        async run(fromMessageId?: string) {
          if (get().status !== "idle") {
            throw new Error("Thread is already running");
          }
          const runValidationIssue = getRunValidationIssue(
            get().thread.context?.messages ?? []
          );
          if (runValidationIssue !== null) {
            set({ runValidationIssue });
            return;
          }
          set({ runValidationIssue: null });
          const runtime = options.executionRuntime;
          if (runtime === undefined) {
            toast.error("This Thread is display-only");
            return;
          }
          const runId = uuid();
          const abortController = new AbortController();
          set({
            status: "preparing",
            activeRunId: runId,
            abortController,
            streamingMessage: null,
            executingToolCallIds: [],
            pendingToolApproval: null,
          });
          stopActiveRun = () => {
            abortController.abort();
            void runtime.cancel();
          };
          try {
            const thread = get().thread;
            const messages = thread.context?.messages ?? [];
            const selectedId = fromMessageId ?? messages.at(-1)?.id;
            const selected = messages.find((message) => message.id === selectedId);
            const projection =
              get().acpSession ??
              createAcpSessionProjection(runtime.sessionId);
            const mode = options.getReactLoop?.()
              ? "continue"
              : options.getAutoRunTools?.()
                ? "turn"
                : "step";
            const action = _acpAction(projection);
            if (
              selected?.role === "user" &&
              (projection.messages[selected.id] === undefined ||
                action === undefined)
            ) {
              await executeAcpCommand(
                (client, signal) =>
                  client.prompt({
                    prompt: selected.content.map(_coreContentToAcp),
                    fromMessageId: selected.id,
                    mode,
                    thread,
                    signal,
                  }),
                abortController.signal
              );
            } else {
              if (action === undefined) {
                throw new Error(
                  "ACP Session has no pending action and no new user prompt."
                );
              }
              await executeAcpCommand(
                (client, signal) =>
                  mode === "continue"
                    ? client.continue({
                        operationId: action.operationId,
                        signal,
                      })
                    : mode === "turn"
                      ? client.turn({ ...action, signal })
                      : client.step({ ...action, signal }),
                abortController.signal
              );
            }
          } catch (error) {
            if (!abortController.signal.aborted) {
              toast.error("Unable to run Thread", {
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
          } finally {
            if (get().activeRunId === runId) {
              const thread = get().thread;
              set({
                status: "idle",
                activeRunId: null,
                abortController: null,
                streamingMessage: null,
                executingToolCallIds: [],
                changeHistory: recordSnapshot(get().changeHistory, thread),
              });
            }
            stopActiveRun = null;
          }
        },
        async runExternalToolCall(messageId: string, toolCallId: string) {
          void messageId;
          const runtime = options.executionRuntime;
          if (runtime === undefined || get().status !== "idle") return false;
          const projection = get().acpSession;
          if (projection === null) return false;
          const action = _acpAction(projection);
          if (
            action?.kind !== "tool" ||
            _acpNextToolCallId(projection) !== toolCallId
          ) {
            return false;
          }
          const runId = uuid();
          const abortController = new AbortController();
          set({
            status: "preparing",
            activeRunId: runId,
            abortController,
            executingToolCallIds: [toolCallId],
          });
          stopActiveRun = () => {
            abortController.abort();
            void runtime.cancel();
          };
          try {
            await executeAcpCommand(
              (client, signal) => client.step({ ...action, signal }),
              abortController.signal
            );
            return true;
          } finally {
            if (get().activeRunId === runId) {
              set({
                status: "idle",
                activeRunId: null,
                abortController: null,
                executingToolCallIds: [],
              });
            }
            stopActiveRun = null;
          }
        },
        async resolveToolApproval(approved: boolean) {
          const approval = get().pendingToolApproval;
          const runtime = options.executionRuntime;
          const projection = get().acpSession;
          const action =
            projection === null ? undefined : _acpAction(projection);
          if (
            approval === null ||
            runtime === undefined ||
            action === undefined ||
            get().status !== "idle"
          ) {
            return false;
          }
          const runId = uuid();
          const abortController = new AbortController();
          set({
            status: "preparing",
            activeRunId: runId,
            abortController,
            executingToolCallIds: [approval.toolCallId],
            pendingToolApproval: null,
          });
          stopActiveRun = () => {
            abortController.abort();
            void runtime.cancel();
          };
          try {
            await executeAcpCommand(
              (client, signal) =>
                client.requestPermission({
                  operationId: action.operationId,
                  expectedActionId: action.expectedActionId,
                  toolCallId: approval.toolCallId,
                  optionId: approved ? "allow_once" : "reject_once",
                  resumeMode: approval.resumeMode,
                  signal,
                }),
              abortController.signal
            );
            return true;
          } catch (error) {
            if (!abortController.signal.aborted) {
              set({ pendingToolApproval: approval });
              toast.error("Unable to resolve Tool approval", {
                description:
                  error instanceof Error ? error.message : "Please try again.",
              });
            }
            return false;
          } finally {
            if (get().activeRunId === runId) {
              set({
                status: "idle",
                activeRunId: null,
                abortController: null,
                executingToolCallIds: [],
              });
            }
            stopActiveRun = null;
          }
        },
        undo() {
          if (get().status !== "idle") {
            return;
          }
          const result = undoHistory(get().changeHistory);
          if (!result) {
            return;
          }
          const thread = withRunMetadata(result.thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: get().evaluationRubrics,
          });
          set({
            thread,
            runValidationIssue: null,
            changeHistory: {
              ...result.history,
              snapshots: result.history.snapshots.map((snapshot, index) =>
                index === result.history.index ? thread : snapshot
              ),
            },
          });
        },
        redo() {
          if (get().status !== "idle") {
            return;
          }
          const result = redoHistory(get().changeHistory);
          if (!result) {
            return;
          }
          const thread = withRunMetadata(result.thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: get().evaluationRubrics,
          });
          set({
            thread,
            runValidationIssue: null,
            changeHistory: {
              ...result.history,
              snapshots: result.history.snapshots.map((snapshot, index) =>
                index === result.history.index ? thread : snapshot
              ),
            },
          });
        },
        restoreThread(thread: Thread) {
          if (get().status !== "idle") {
            return;
          }
          const next = withRunMetadata(thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: get().evaluationRubrics,
          });
          if (next === get().thread) {
            return;
          }
          // Replace the whole thread; recorded as a single undoable step.
          set({
            thread: next,
            runValidationIssue: null,
            changeHistory: recordSnapshot(get().changeHistory, next),
          });
        },
        removeRun(run: RunSnapshot) {
          if (get().status !== "idle") {
            return;
          }
          const current = get().runHistory;
          const runHistory = current.filter((r) => r !== run);
          if (runHistory.length === current.length) {
            return;
          }
          const evaluations = normalizeEvaluations(
            get().evaluations,
            runHistory
          );
          // Deleting a run is not an undoable edit — undo/redo re-attach the
          // live runHistory anyway — so update the current snapshot in place
          // instead of recording a new step.
          const thread = withRunMetadata(get().thread, {
            runHistory,
            evaluations,
            evaluationRubrics: get().evaluationRubrics,
          });
          const history = get().changeHistory;
          set({
            thread,
            runHistory,
            evaluations,
            changeHistory: {
              ...history,
              snapshots: history.snapshots.map((snapshot, index) =>
                index === history.index ? thread : snapshot
              ),
            },
          });
          publishRunMetadata(runHistory, evaluations, get().evaluationRubrics);
        },
        saveEvaluation(input) {
          if (get().status !== "idle") {
            return false;
          }
          const evaluations = upsertEvaluation(
            get().evaluations,
            get().runHistory,
            input
          );
          if (!evaluations) {
            return false;
          }
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations,
            evaluationRubrics: get().evaluationRubrics,
          });
          // Evaluation records are durable run metadata, not a text-edit undo
          // step; replace the current history tip so undo stays content-focused.
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluations,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                index === changeHistory.index ? thread : snapshot
              ),
            },
          });
          publishRunMetadata(
            get().runHistory,
            evaluations,
            get().evaluationRubrics
          );
          return true;
        },
        removeEvaluation(evaluation: EvaluationRecord) {
          if (get().status !== "idle") {
            return;
          }
          const current = get().evaluations;
          const evaluations = current.filter((e) => e.id !== evaluation.id);
          if (evaluations.length === current.length) {
            return;
          }
          // Like removeRun, deleting an evaluation is not an undoable edit;
          // update the current history snapshot in place instead of recording
          // a new step.
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations,
            evaluationRubrics: get().evaluationRubrics,
          });
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluations,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                index === changeHistory.index ? thread : snapshot
              ),
            },
          });
          publishRunMetadata(
            get().runHistory,
            evaluations,
            get().evaluationRubrics
          );
        },
        saveEvaluationRubric(input) {
          if (get().status !== "idle") {
            return null;
          }
          const result = upsertEvaluationRubric(get().evaluationRubrics, input);
          if (!result) {
            return null;
          }
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: result.rubrics,
          });
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluationRubrics: result.rubrics,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                index === changeHistory.index ? thread : snapshot
              ),
            },
          });
          publishRunMetadata(
            get().runHistory,
            get().evaluations,
            result.rubrics
          );
          return result.rubric;
        },
        removeEvaluationRubric(id) {
          if (get().status !== "idle") {
            return false;
          }
          const current = get().evaluationRubrics;
          const evaluationRubrics = current.filter(
            (rubric) => rubric.id !== id
          );
          if (evaluationRubrics.length === current.length) {
            return false;
          }
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics,
          });
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluationRubrics,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                index === changeHistory.index ? thread : snapshot
              ),
            },
          });
          publishRunMetadata(
            get().runHistory,
            get().evaluations,
            evaluationRubrics
          );
          return true;
        },
        abort() {
          const { status } = get();
          if (status === "preparing") {
            set({ status: "idle", activeRunId: null });
            return;
          }
          if (status !== "running") {
            return;
          }
          stopActiveRun?.();
        },
      };
    })
  );
}

function _coreContentToAcp(content: MessageContent): ContentBlock {
  return content.type === "text"
    ? { type: "text", text: content.text }
    : { type: "image", data: content.data, mimeType: content.mimeType };
}

/** Derives the editor's presentational model from the ACP execution authority. */
function _acpProjectionToThread(
  projection: AcpSessionProjection,
  base: Thread
): Thread {
  const updates: SharedSessionUpdate[] = [
    ...projection.messageOrder.flatMap((messageId) => {
      const message = projection.messages[messageId];
      if (message === undefined) return [];
      return [
        {
          sessionUpdate:
            message.role === "user"
              ? "user_message"
              : message.role === "agent"
                ? "agent_message"
                : "agent_thought",
          messageId: message.messageId,
          content: message.content.flatMap(_acpContentToCore),
          ...(message.meta === undefined ? {} : { _meta: message.meta }),
        } satisfies SharedSessionUpdate,
      ];
    }),
    ...projection.toolCallOrder.flatMap((toolCallId) => {
      const toolCall = projection.toolCalls[toolCallId];
      if (toolCall === undefined) return [];
      const output = _acpToolOutput(toolCall);
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          ...(toolCall.name === undefined ? {} : { name: toolCall.name }),
          ...(toolCall.title === undefined ? {} : { title: toolCall.title }),
          ...(toolCall.status === "pending" ||
          toolCall.status === "in_progress" ||
          toolCall.status === "completed" ||
          toolCall.status === "failed"
            ? { status: toolCall.status }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(toolCall, "rawInput")
            ? { rawInput: toolCall.rawInput }
            : {}),
          ...(output === undefined
            ? {}
            : {
                content: output.content.map((content) => ({
                  type: "content" as const,
                  content,
                })),
              }),
          ...(toolCall.meta === undefined ? {} : { _meta: toolCall.meta }),
        } satisfies SharedSessionUpdate,
      ];
    }),
  ];
  const messages = messagesFromSharedSessionUpdates(updates);
  const projectedIds = new Set(messages.map((message) => message.id));
  const uncommittedUsers = (base.context?.messages ?? []).filter(
    (message) => message.role === "user" && !projectedIds.has(message.id)
  );
  return normalizeThread({
    ...base,
    context: {
      ...base.context,
      messages: [...messages, ...uncommittedUsers],
    },
  });
}

function _acpContentToCore(content: ContentBlock): MessageContent[] {
  const value = content as unknown;
  if (!_isRecord(value)) return [];
  if (value.type === "text" && typeof value.text === "string") {
    return [{ type: "text", text: value.text }];
  }
  if (
    value.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    return [{ type: "image", data: value.data, mimeType: value.mimeType }];
  }
  return [];
}

/** Keeps the committed Thread reference stable on the token-stream hot path. */
function _acpStreamingAssistant(
  projection: AcpSessionProjection,
  updateMessageId: string
): AssistantMessage {
  const messageId = updateMessageId.endsWith(":thought")
    ? updateMessageId.slice(0, -":thought".length)
    : updateMessageId;
  const message = projection.messages[messageId];
  const thought = projection.messages[`${messageId}:thought`];
  const thinking = thought?.content
    .flatMap((content) =>
      _acpContentToCore(content).flatMap((item) =>
        item.type === "text" ? [item.text] : []
      )
    )
    .join("");
  return {
    id: messageId,
    role: "assistant",
    content: (message?.content ?? []).flatMap((content) =>
      _acpContentToCore(content).flatMap((item) =>
        item.type === "text" ? [item] : []
      )
    ),
    ...(thinking === undefined || thinking.length === 0 ? {} : { thinking }),
  };
}

function _acpToolOutput(
  toolCall: AcpSessionProjection["toolCalls"][string]
): ToolCallOutput | undefined {
  if (toolCall.status !== "completed" && toolCall.status !== "failed") {
    return undefined;
  }
  const content: MessageContent[] = [];
  for (const item of toolCall.content ?? []) {
    if (!_isRecord(item) || item.type !== "content") continue;
    const block = item.content;
    if (!_isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
      continue;
    }
    if (
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      content.push({
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
      });
    }
  }
  return {
    content,
    ...(toolCall.status === "failed" ? { isError: true } : {}),
  };
}

function _acpAction(
  projection: AcpSessionProjection
): Omit<AcpRuntimeAction, "signal"> | undefined {
  const details = _llmSpaceMeta(projection.meta);
  const operationId = details?.operationId;
  const nextAction = details?.nextAction;
  if (
    typeof operationId !== "string" ||
    !_isRecord(nextAction) ||
    typeof nextAction.id !== "string" ||
    (nextAction.kind !== "model" && nextAction.kind !== "tool")
  ) {
    return undefined;
  }
  return {
    operationId,
    expectedActionId: nextAction.id,
    kind: nextAction.kind,
  };
}

function _acpNextToolCallId(
  projection: AcpSessionProjection
): string | undefined {
  const nextAction = _llmSpaceMeta(projection.meta)?.nextAction;
  return _isRecord(nextAction) && typeof nextAction.toolCallId === "string"
    ? nextAction.toolCallId
    : undefined;
}

function _acpApproval(
  projection: AcpSessionProjection
): { readonly toolCallId: string; readonly toolName: string } | undefined {
  const approval = _llmSpaceMeta(projection.meta)?.approval;
  if (
    !_isRecord(approval) ||
    typeof approval.toolCallId !== "string" ||
    typeof approval.toolName !== "string"
  ) {
    return undefined;
  }
  return { toolCallId: approval.toolCallId, toolName: approval.toolName };
}

function _llmSpaceMeta(
  meta: Readonly<Record<string, unknown>> | null | undefined
): Readonly<Record<string, unknown>> | undefined {
  const value = meta?.["llm-space.dev"];
  return _isRecord(value) ? value : undefined;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const ThreadStoreContext = createContext<ThreadStore | null>(null);

export function useThreadStoreApi(): ThreadStore {
  const store = useContext(ThreadStoreContext);
  if (!store) throw new Error("hooks must be used within <ThreadPlayground>");
  return store;
}

export function useThreadStore<T>(selector: (s: ThreadState) => T): T {
  return useStore(useThreadStoreApi(), selector);
}

const selectActions = (s: ThreadState) => ({
  run: s.run,
  runExternalToolCall: s.runExternalToolCall,
  resolveToolApproval: s.resolveToolApproval,
  resolveRunValidationIssue: s.resolveRunValidationIssue,
  abort: s.abort,
  undo: s.undo,
  redo: s.redo,
  restoreThread: s.restoreThread,
  removeRun: s.removeRun,
  saveEvaluation: s.saveEvaluation,
  removeEvaluation: s.removeEvaluation,
  saveEvaluationRubric: s.saveEvaluationRubric,
  removeEvaluationRubric: s.removeEvaluationRubric,

  appendMessage: s.appendMessage,
  insertMessageBefore: s.insertMessageBefore,
  moveMessage: s.moveMessage,
  removeMessage: s.removeMessage,
  updateSystemPrompt: s.updateSystemPrompt,
  updatePromptVariable: s.updatePromptVariable,
  removePromptVariable: s.removePromptVariable,
  renamePromptVariable: s.renamePromptVariable,
  addCustomVariable: s.addCustomVariable,
  updateCustomVariable: s.updateCustomVariable,
  renameCustomVariable: s.renameCustomVariable,
  removeCustomVariable: s.removeCustomVariable,
  updateTitle: s.updateTitle,
  syncTitle: s.syncTitle,
  updateModelParams: s.updateModelParams,
  updateModel: s.updateModel,
  updateMessageTextContent: s.updateMessageTextContent,
  addMessageImageContent: s.addMessageImageContent,
  removeMessageImageContent: s.removeMessageImageContent,
  updateToolCallOutput: s.updateToolCallOutputContent,
  updateToolCallOutputText: s.updateToolCallOutputTextContent,
  addTool: s.addTool,
  updateTool: s.updateTool,
  removeTool: s.removeTool,
  toggleMessageRole: s.toggleMessageRole,
  toggleMessageCollapsed: s.toggleMessageCollapsed,
});
export function useThreadStoreActions() {
  return useStore(useThreadStoreApi(), useShallow(selectActions));
}
