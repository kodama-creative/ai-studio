
import {
  type AgentTransport,
  getMessageText,
  isRunnableConversation,
  type MessageContent,
  type ModelConfig,
  type ModelConfigParams,
  normalizeThread,
  type ReducedMessageContent,
  reduceMessages,
  RUN_LAST_MESSAGE_ERROR,
  streamThread,
  type Thread,
  type ThreadContext,
  type ThreadVariable,
  type ThreadVariables,
  type ThreadVariableVariants,
  type Tool,
  Tool as ToolSchema,
  type UserMessage,
  uuid
} from "@llm-space/core";
import {
  aggregateMessageUsage,
  createMessagePromptVariablePlaceKey,
  createToolResultPromptVariablePlaceKey,
  DEFAULT_VARIABLE_VARIANT_NAME,
  ensureThreadVariableState,
  type EvaluationRecord,
  type EvaluationRubricInput,
  type EvaluationRubricRecord,
  type EvaluationRubricSnapshot,
  type EvaluationRunScores,
  normalizeEvaluationRubrics,
  normalizeEvaluations,
  normalizePromptVariableState,
  normalizeRunHistory,
  PromptVariableError,
  recordRun,
  removePromptVariableSnapshotPlaces,
  renderThreadPromptVariables,
  replaceThreadPromptVariableReferences,
  type RunSnapshot,
  SYSTEM_PROMPT_PLACE_KEY,
  upsertEvaluation,
  upsertEvaluationRubric,
  withPromptVariableSnapshot,
  withRunMetadata
} from "@llm-space/core/thread";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import { Compile } from "typebox/compile";
import { createStore, type StoreApi, useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/shallow";

import type {
  AssistantMessage,
  Message
} from "@llm-space/core";
import type { RuntimeExecutionMode } from "@llm-space/runtime";

import { createFrameThrottle } from "@/lib/frame-throttle";
import { resolveRuntimeExecutionMode } from "./run-mode";
import {
  type ChangeHistory,
  createInitialHistory,
  recordSnapshot,
  redo as redoHistory,
  undo as undoHistory
} from "./thread-history";
import {
  ThreadRuntimeOutcomeUnknownError,
  ThreadRuntimeSession
} from "./thread-runtime-session";
import { PREVIEW_THROTTLE_MS } from "../streaming-preview";
import { listEnabledPromptVariableSkills } from "../variable/prompt-variable-skills";

const toolValidator = Compile(ToolSchema);

export type ThreadStoreStatus = "idle" | "running";
export interface ThreadState {
  thread: Thread;
  streamingMessage: AssistantMessage | null;
  status: ThreadStoreStatus;
  abortController: AbortController | null;
  activeRunId: string | null;
  collapsedMessageIds: string[];

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
  undo(): void;
  redo(): void;
  restoreThread(thread: Thread): void;
  removeRun(run: RunSnapshot): void;
  saveEvaluation(input: {
    leftRunId: string;
    note?: string;
    rightRunId: string;
    rubric?: EvaluationRubricSnapshot;
    runScores?: EvaluationRunScores[];
    verdict: EvaluationRecord["verdict"];
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
  updateToolCallOutputTextContent(
    messageId: string,
    toolCallId: string,
    text: string,
    isError?: boolean
  ): void;
  markToolCallAttempt(messageId: string, toolCallId: string, at: string): void;
  continueAfterProjectToolResult(messageId: string): Promise<boolean>;
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

    /** Skills available to prompt-variable rendering for this Thread. */
    loadPromptSkills?: typeof listEnabledPromptVariableSkills;

    /** Add host-owned runtime provenance before recording a run snapshot. */
    prepareRunSnapshot?: (thread: Thread) => Thread;

    /** Persist a Runtime Run start or settled boundary before returning. */
    persistSettledThread?: (thread: Thread) => Promise<void>;

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

    /** Runtime transport owns tool execution and continuation for this Thread. */
    runtimeOwnsToolLoop?: boolean;
    transport: AgentTransport;
  }
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
    evaluationRubrics: initialEvaluationRubrics
  });
  let runtimeSession = new ThreadRuntimeSession(
    normalizedInitialThread.runtimeSession
  );

  return createStore<ThreadState>()(
    subscribeWithSelector((set, get) => {
      // --- internal helpers ---------------------------------------------------

      let stopActiveRun: (() => void) | null = null;

      const applyRuntimeSession = (
        session: Thread["runtimeSession"]
      ): Thread => {
        const thread = { ...get().thread, runtimeSession: session };
        const changeHistory = get().changeHistory;
        set({
          thread,
          changeHistory: {
            ...changeHistory,
            snapshots: changeHistory.snapshots.map((snapshot, index) =>
              (index === changeHistory.index ? thread : snapshot))
          }
        });
        return thread;
      };

      const persistRuntimeSession = async (
        session: Thread["runtimeSession"]
      ): Promise<void> => {
        await options.persistSettledThread?.(applyRuntimeSession(session));
      };

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

      const getVariableState = () =>
        normalizePromptVariableState(get().thread.context);

      const setVariableState = (
        variables: ThreadVariables,
        variableVariants: ThreadVariableVariants,
        systemPrompt = get().thread.context?.systemPrompt
      ) => {
        patchContext({ variables, variableVariants, systemPrompt });
      };

      const defaultCustomValues = (variableVariants: ThreadVariableVariants) =>
        variableVariants.variants[DEFAULT_VARIABLE_VARIANT_NAME] ?? {};

      const customVariableNames = (variableVariants: ThreadVariableVariants) =>
        new Set(Object.keys(defaultCustomValues(variableVariants)));

      const withDefaultCustomValues = (
        values: Record<string, string>
      ): ThreadVariableVariants => ({
        active: DEFAULT_VARIABLE_VARIANT_NAME,
        variants: { [DEFAULT_VARIABLE_VARIANT_NAME]: values }
      });

      /*
       * Custom variables now expose one explicit default set, so every edit
       * rewrites the state to that single bucket.
       */
      const setDefaultCustomValues = (
        variables: ThreadVariables,
        values: Record<string, string>,
        systemPrompt = get().thread.context?.systemPrompt
      ) => {
        setVariableState(
          variables,
          withDefaultCustomValues(values),
          systemPrompt
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
          description: `"${name}" is already used by another variable.`
        });
      };

      const setMessages = (messages: Message[]) => {
        patchContext({ messages });
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
          message => message.id === id
        );

      /** Replace a single message by id; no-op (same array ref) if not found. */
      const updateMessage = (
        id: string,
        updater: (message: Message) => Message
      ) => {
        updateMessages(messages => {
          let changed = false;
          const next = messages.map(message => {
            if (message.id !== id) {
              return message;
            }
            changed = true;
            return updater(message);
          });
          return changed ? next : messages;
        });
      };

      const createUserMessage = (): UserMessage => ({
        id: uuid(),
        role: "user",
        content: [{ type: "text", text: "" }]
      });

      /** Validate a tool against the schema, toasting the first errors. */
      const validateTool = (tool: Tool): boolean => {
        if (!toolValidator.Check(tool)) {
          const errors = [...toolValidator.Errors(tool)];
          toast.error("Error", {
            description:
              errors.map(e => e.message).join(", ") || "Invalid tool"
          });
          return false;
        }
        return true;
      };

      /** Keep image contents before any other content, preserving order. */
      const partitionImagesFirst = (content: UserMessage["content"]) => [
        ...content.filter(c => c.type === "image_data"),
        ...content.filter(c => c.type !== "image_data")
      ];

      const hasContent = (message: AssistantMessage): boolean =>
        Boolean(message.thinking)
        || message.content.length > 0
        || (message.toolCalls?.length ?? 0) > 0;

      const getExecutionMode = (): RuntimeExecutionMode =>
        resolveRuntimeExecutionMode(
          options.getAutoRunTools?.() ?? false,
          options.getReactLoop?.() ?? false
        );

      // --- store --------------------------------------------------------------

      return {
        thread: normalizedInitialThread,
        streamingMessage: null,
        status: "idle",
        abortController: null,
        activeRunId: null,
        collapsedMessageIds: [],
        autoFocusMessageId: null,
        changeHistory: createInitialHistory(normalizedInitialThread),
        runHistory: initialRunHistory,
        evaluations: initialEvaluations,
        evaluationRubrics: initialEvaluationRubrics,

        appendMessage() {
          const message = createUserMessage();
          updateMessages(messages => [...messages, message]);
          set({ autoFocusMessageId: message.id });
        },
        insertMessageBefore(beforeMessageId: string) {
          const messages = get().thread.context?.messages ?? [];
          const index = messages.findIndex(m => m.id === beforeMessageId);
          if (index === -1) {
            return;
          }
          const message = createUserMessage();
          setMessages([
            ...messages.slice(0, index),
            message,
            ...messages.slice(index)
          ]);
          set({ autoFocusMessageId: message.id });
        },
        moveMessage(fromIndex: number, toIndex: number) {
          updateMessages(messages => {
            if (
              fromIndex === toIndex
              || fromIndex < 0
              || toIndex < 0
              || fromIndex >= messages.length
              || toIndex >= messages.length
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
          updateMessages(messages => messages.filter(m => m.id !== id));
          const { collapsedMessageIds } = get();
          if (collapsedMessageIds.includes(id)) {
            set({
              collapsedMessageIds: collapsedMessageIds.filter(
                cid => cid !== id
              )
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
              SYSTEM_PROMPT_PLACE_KEY
            ])
          });
        },
        updatePromptVariable(name, variable) {
          const { variables, variableVariants } = getVariableState();
          setVariableState(
            { ...variables, [name]: variable },
            variableVariants
          );
        },
        renamePromptVariable(oldName, newName) {
          if (oldName === newName) {
            return true;
          }
          const { variables, variableVariants } = getVariableState();
          if (
            Object.hasOwn(variables, newName)
            || allCustomVariableNames(variableVariants).has(newName)
          ) {
            showDuplicateVariableName(newName);
            return false;
          }
          const variable = variables[oldName];
          if (!variable) {
            return false;
          }
          const nextVariables = { ...variables };
          Reflect.deleteProperty(nextVariables, oldName);
          nextVariables[newName] = variable;
          patchThread({
            context: replaceThreadPromptVariableReferences(
              {
                ...(get().thread.context ?? {}),
                variables: nextVariables,
                variableVariants
              },
              oldName,
              newName
            )
          });
          return true;
        },
        addCustomVariable(name, value = "") {
          const { variables, variableVariants } = getVariableState();
          const customValues = defaultCustomValues(variableVariants);
          if (Object.hasOwn(variables, name)) {
            showDuplicateVariableName(name);
            return false;
          }
          if (Object.hasOwn(customValues, name)) {
            showDuplicateVariableName(name);
            return false;
          }
          setDefaultCustomValues(variables, { ...customValues, [name]: value });
          return true;
        },
        updateCustomVariable(name, value) {
          const { variables, variableVariants } = getVariableState();
          const customValues = defaultCustomValues(variableVariants);
          setDefaultCustomValues(variables, { ...customValues, [name]: value });
        },
        renameCustomVariable(oldName, newName) {
          if (oldName === newName) {
            return true;
          }
          const { variables, variableVariants } = getVariableState();
          const existingCustomNames = customVariableNames(variableVariants);
          existingCustomNames.delete(oldName);
          if (
            Object.hasOwn(variables, newName)
            || existingCustomNames.has(newName)
          ) {
            showDuplicateVariableName(newName);
            return false;
          }
          const customValues = defaultCustomValues(variableVariants);
          if (!Object.hasOwn(customValues, oldName)) {
            return false;
          }
          const nextValues = { ...customValues };
          const value = nextValues[oldName];
          Reflect.deleteProperty(nextValues, oldName);
          nextValues[newName] = value;
          patchThread({
            context: replaceThreadPromptVariableReferences(
              {
                ...(get().thread.context ?? {}),
                variables,
                variableVariants: withDefaultCustomValues(nextValues)
              },
              oldName,
              newName
            )
          });
          return true;
        },
        removeCustomVariable(name) {
          const { variables, variableVariants } = getVariableState();
          const nextValues = { ...defaultCustomValues(variableVariants) };
          Reflect.deleteProperty(nextValues, name);
          setDefaultCustomValues(variables, nextValues);
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
            model: { ...base, params: { ...base.params, ...params } }
          });
        },
        updateModel(model: Pick<ModelConfig, "id" | "provider">) {
          const current = get().thread.model;
          patchThread({
            model: { ...current, provider: model.provider, id: model.id }
          });
        },
        updateMessageTextContent(id: string, text: string) {
          const context = get().thread.context ?? {};
          const messages = context.messages ?? [];
          let changed = false;
          const nextMessages = messages.map(message => {
            if (message.id !== id) {
              return message;
            }
            if (getMessageText(message) === text) {
              return message;
            }
            changed = true;
            const content = [...message.content] as MessageContent[];
            const index = content.findIndex(c => c.type === "text");
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
              createMessagePromptVariablePlaceKey(id)
            ])
          });
        },
        addMessageImageContent(id: string, mimeType: string, data: string) {
          if (getMessage(id)?.role !== "user") {
            return;
          }
          updateMessage(id, message => {
            const user = message as UserMessage;
            return {
              ...user,
              content: partitionImagesFirst([
                ...user.content,
                { type: "image_data", mimeType, data }
              ])
            };
          });
        },
        removeMessageImageContent(id: string, contentIndex: number) {
          const message = getMessage(id);
          if (message?.role !== "user") {
            return;
          }
          if (message.content[contentIndex]?.type !== "image_data") {
            return;
          }
          updateMessage(id, m => {
            const user = m as UserMessage;
            return {
              ...user,
              content: partitionImagesFirst(
                user.content.filter((_, index) => index !== contentIndex)
              )
            };
          });
        },
        addTool(tool) {
          const { thread } = get();
          if (thread.context?.tools?.some(t => t.name === tool.name)) {
            toast.error("Error", {
              description: `Tool "${tool.name}" already exists`
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
          const index = tools.findIndex(t => t.name === name);
          if (index === -1) {
            return false;
          }
          if (!validateTool(tool)) {
            return false;
          }
          if (tool.name !== name && tools.some(t => t.name === tool.name)) {
            toast.error("Error", {
              description: `Tool "${tool.name}" already exists`
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
            tools: get().thread.context?.tools?.filter(t => t.name !== name)
          });
        },
        markToolCallAttempt(messageId, toolCallId, at) {
          const context = get().thread.context ?? {};
          const messages = context.messages ?? [];
          let changed = false;
          const nextMessages = messages.map(message => {
            if (message.id !== messageId || message.role !== "assistant") {
              return message;
            }
            let messageChanged = false;
            const toolCalls = message.toolCalls?.map(toolCall => {
              if (toolCall.id !== toolCallId) { return toolCall; }
              changed = true;
              messageChanged = true;
              return {
                ...toolCall,
                attempt: { status: "started" as const, at }
              };
            });
            return messageChanged ? { ...message, toolCalls } : message;
          });
          if (changed) { patchContext({ messages: nextMessages }); }
        },
        async continueAfterProjectToolResult(messageId) {
          if (
            !options.runtimeOwnsToolLoop
            || !(options.getReactLoop?.() ?? false)
            || get().status === "running"
          ) {
            return false;
          }
          const message = getMessage(messageId);
          if (
            message?.role !== "assistant"
            || !message.toolCalls?.length
            || message.toolCalls.some(toolCall => !toolCall.output)
          ) {
            return false;
          }
          await get().run(messageId);
          return true;
        },
        updateToolCallOutputTextContent(messageId, toolCallId, text, isError) {
          const context = get().thread.context ?? {};
          const messages = context.messages ?? [];
          let changed = false;
          let textChanged = false;
          const nextMessages = messages.map(message => {
            if (message.id !== messageId || message.role !== "assistant") {
              return message;
            }
            let toolCallChanged = false;
            const toolCalls = message.toolCalls?.map(toolCall => {
              if (toolCall.id !== toolCallId) {
                return toolCall;
              }
              const currentText =
                toolCall.output?.content.map(item => item.text).join("\n")
                ?? "";
              const nextIsError = isError ?? toolCall.output?.isError;
              if (
                currentText === text
                && toolCall.output?.isError === nextIsError
              ) {
                return toolCall;
              }
              toolCallChanged = true;
              textChanged = textChanged || currentText !== text;
              return {
                ...toolCall,
                output: {
                  content: [{ type: "text" as const, text }],
                  isError: nextIsError
                }
              };
            });
            if (!toolCallChanged) {
              return message;
            }
            changed = true;
            return { ...message, toolCalls };
          });
          if (!changed) {
            return;
          }
          patchContext({
            messages: nextMessages,
            ...(textChanged
              ? {
                snapshot: removePromptVariableSnapshotPlaces(
                  context.snapshot,
                  [
                    createToolResultPromptVariablePlaceKey(
                      messageId,
                      toolCallId
                    )
                  ]
                )
              }
              : {})
          });
        },
        toggleMessageRole(id: string) {
          updateMessage(
            id,
            message =>
              ({
                ...message,
                role: message.role === "user" ? "assistant" : "user"
              }) as Message
          );
        },
        toggleMessageCollapsed(id: string) {
          const { collapsedMessageIds } = get();
          set({
            collapsedMessageIds: collapsedMessageIds.includes(id)
              ? collapsedMessageIds.filter(i => i !== id)
              : [...collapsedMessageIds, id]
          });
        },
        async run(fromMessageId?: string) {
          if (get().status === "running") {
            throw new Error("Thread is already running");
          }
          const model = options.resolveModel?.(get().thread.model) ?? null;
          if (!model) {
            toast.error("Select a model to run");
            return;
          }
          let messages = [...(get().thread.context?.messages ?? [])];
          let truncated = false;
          if (fromMessageId) {
            const index = messages.findIndex(m => m.id === fromMessageId);
            if (index !== -1 && index !== messages.length - 1) {
              messages = messages.slice(0, index + 1);
              truncated = true;
            }
          }
          if (!isRunnableConversation(messages)) {
            toast.error("Error", { description: RUN_LAST_MESSAGE_ERROR });
            return;
          }

          let promptSnapshot: ThreadContext["snapshot"] =
            get().thread.context?.snapshot;
          let preparedContext: ThreadContext;
          try {
            const rendered = await renderThreadPromptVariables({
              context: { ...get().thread.context, messages },
              loadSkills:
                options.loadPromptSkills ?? listEnabledPromptVariableSkills
            });
            preparedContext = rendered.context;
            promptSnapshot = rendered.snapshot;
          } catch (error) {
            toast.error("Unable to render prompt variables", {
              description:
                error instanceof PromptVariableError || error instanceof Error
                  ? error.message
                  : "Please check the system prompt variables."
            });
            return;
          }

          const executionMode = getExecutionMode();
          const previousRuntimeSession = get().thread.runtimeSession;
          const executionThread =
            options.prepareRunSnapshot?.({
              ...get().thread,
              context: preparedContext
            }) ?? { ...get().thread, context: preparedContext };
          let begun;
          try {
            begun = await runtimeSession.begin({
              thread: executionThread,
              context: preparedContext,
              executionMode,
              model
            });
            await persistRuntimeSession(begun.session);
          } catch (error) {
            if (error instanceof ThreadRuntimeOutcomeUnknownError) {
              try {
                await persistRuntimeSession(error.session);
              } catch (persistError) {
                runtimeSession = new ThreadRuntimeSession(
                  previousRuntimeSession
                );
                applyRuntimeSession(previousRuntimeSession);
                toast.error("Unable to persist Runtime recovery", {
                  description:
                    persistError instanceof Error
                      ? persistError.message
                      : "Runtime Session recovery failed"
                });
                return;
              }
              toast.error("Runtime Run outcome unknown", {
                description: error.message
              });
              return;
            }
            runtimeSession = new ThreadRuntimeSession(previousRuntimeSession);
            applyRuntimeSession(previousRuntimeSession);
            toast.error("Unable to start Runtime Run", {
              description:
                error instanceof Error ? error.message : "Runtime Session failed"
            });
            return;
          }

          const abortController = new AbortController();
          const runId = begun.runId;
          const isActiveRun = () => get().activeRunId === runId;
          set({
            status: "running",
            abortController,
            activeRunId: runId,
            streamingMessage: null
          });
          if (truncated) {
            setMessages(messages);
          }
          const runStartMessageCount = messages.length;

          const commit = (message: AssistantMessage) => {
            if (!isActiveRun()) {
              return;
            }
            messages = [...messages, message];
            setMessages(messages);
          };

          let streamingMessage: AssistantMessage | null = null;
          let content: ReducedMessageContent[] = [];
          let sawEvent = false;
          const { schedule: schedulePreview, cancel: cancelPreview } =
            createFrameThrottle(() => {
              if (isActiveRun()) {
                set({ streamingMessage });
              }
            }, PREVIEW_THROTTLE_MS);

          stopActiveRun = () => {
            if (!isActiveRun()) {
              return;
            }
            try {
              abortController.abort();
            } catch {
              // Ignored
            }
          };

          const streamRuntimeRun = async (): Promise<
            "cancelled" | "completed" | "failed"
          > => {
            try {
              promptSnapshot = preparedContext.snapshot;
              const response = streamThread(
                { context: preparedContext, model },
                {
                  signal: abortController.signal,
                  transport: options.transport
                }
              );
              for await (const chunk of response) {
                if (!isActiveRun()) {
                  return "cancelled";
                }
                sawEvent = true;
                const reduced = reduceMessages(chunk, {
                  streamingMessage,
                  content
                });
                if (!reduced) {
                  continue;
                }
                if (reduced.type === "message_start" && streamingMessage) {
                  commit(streamingMessage);
                  cancelPreview();
                  if (isActiveRun()) {
                    set({ streamingMessage: null });
                  }
                }
                streamingMessage = reduced.message;
                content = reduced.content;
                schedulePreview();
              }
              if (!isActiveRun()) {
                return "cancelled";
              }
              if (streamingMessage) {
                commit(streamingMessage);
                cancelPreview();
                if (isActiveRun()) {
                  set({ streamingMessage: null });
                }
                streamingMessage = null;
              }
              return "completed";
            } catch (error) {
              if (abortController.signal.aborted) {
                if (
                  isActiveRun()
                  && streamingMessage
                  && hasContent(streamingMessage)
                ) {
                  commit(streamingMessage);
                  streamingMessage = null;
                }
                return "cancelled";
              }
              console.error(error);
              if (error instanceof Error) {
                toast.error("Error", { description: error.message });
              }
              return "failed";
            }
          };

          const finalizeRuntimeRun = async (
            outcome: "cancelled" | "completed" | "failed"
          ) => {
            if (!isActiveRun()) {
              return;
            }
            cancelPreview();
            stopActiveRun = null;
            const finalThread = withPromptVariableSnapshot(
              get().thread,
              promptSnapshot
            );
            const threadWithSnapshot =
              options.prepareRunSnapshot?.(finalThread) ?? finalThread;
            let settledContext = threadWithSnapshot.context ?? {};
            try {
              settledContext = (
                await renderThreadPromptVariables({
                  context: settledContext,
                  loadSkills:
                    options.loadPromptSkills ?? listEnabledPromptVariableSkills
                })
              ).context;
            } catch {
              // The run already used its frozen prompt snapshot. Keep the final
              // boundary durable; a later execution edit will branch safely.
            }

            try {
              const settled = await runtimeSession.settle({
                thread: threadWithSnapshot,
                context: settledContext,
                executionMode,
                model,
                runId,
                sawEvent,
                outcome
              });
              const threadWithRuntime = {
                ...threadWithSnapshot,
                runtimeSession: settled.session
              };
              const runUsage = aggregateMessageUsage(
                (threadWithRuntime.context?.messages ?? []).slice(
                  runStartMessageCount
                )
              );
              const runHistory = settled.checkpoint
                ? recordRun(
                  get().runHistory,
                  threadWithRuntime,
                  Date.now(),
                  { runtime: settled.checkpoint, usage: runUsage }
                )
                : get().runHistory;
              const evaluations = normalizeEvaluations(
                get().evaluations,
                runHistory
              );
              const thread = withRunMetadata(threadWithRuntime, {
                runHistory,
                evaluations,
                evaluationRubrics: get().evaluationRubrics
              });
              set({
                thread,
                streamingMessage: null,
                changeHistory: recordSnapshot(get().changeHistory, thread),
                runHistory,
                evaluations
              });
              await options.persistSettledThread?.(thread);
              set({
                status: "idle",
                abortController: null,
                activeRunId: null
              });
            } catch (error) {
              set({
                streamingMessage: null,
                status: "idle",
                abortController: null,
                activeRunId: null,
                changeHistory: recordSnapshot(
                  get().changeHistory,
                  get().thread
                )
              });
              toast.error("Unable to persist Runtime Run", {
                description:
                  error instanceof Error ? error.message : "Runtime Session failed"
              });
            }
          };

          const outcome = await streamRuntimeRun();
          await finalizeRuntimeRun(outcome);
        },
        undo() {
          if (get().status === "running") {
            return;
          }
          const result = undoHistory(get().changeHistory);
          if (!result) {
            return;
          }
          const thread = withRunMetadata({
            ...result.thread,
            runtimeSession: get().thread.runtimeSession
          }, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: get().evaluationRubrics
          });
          set({
            thread,
            changeHistory: {
              ...result.history,
              snapshots: result.history.snapshots.map((snapshot, index) =>
                (index === result.history.index ? thread : snapshot))
            }
          });
        },
        redo() {
          if (get().status === "running") {
            return;
          }
          const result = redoHistory(get().changeHistory);
          if (!result) {
            return;
          }
          const thread = withRunMetadata({
            ...result.thread,
            runtimeSession: get().thread.runtimeSession
          }, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: get().evaluationRubrics
          });
          set({
            thread,
            changeHistory: {
              ...result.history,
              snapshots: result.history.snapshots.map((snapshot, index) =>
                (index === result.history.index ? thread : snapshot))
            }
          });
        },
        restoreThread(thread: Thread) {
          if (get().status === "running") {
            return;
          }
          const next = withRunMetadata({
            ...thread,
            runtimeSession: get().thread.runtimeSession
          }, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: get().evaluationRubrics
          });
          if (next === get().thread) {
            return;
          }
          // Replace the whole thread; recorded as a single undoable step.
          set({
            thread: next,
            changeHistory: recordSnapshot(get().changeHistory, next)
          });
        },
        removeRun(run: RunSnapshot) {
          if (get().status === "running") {
            return;
          }
          const current = get().runHistory;
          const runHistory = current.filter(r => r !== run);
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
            evaluationRubrics: get().evaluationRubrics
          });
          const history = get().changeHistory;
          set({
            thread,
            runHistory,
            evaluations,
            changeHistory: {
              ...history,
              snapshots: history.snapshots.map((snapshot, index) =>
                (index === history.index ? thread : snapshot))
            }
          });
        },
        saveEvaluation(input) {
          if (get().status === "running") {
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
            evaluationRubrics: get().evaluationRubrics
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
                (index === changeHistory.index ? thread : snapshot))
            }
          });
          return true;
        },
        removeEvaluation(evaluation: EvaluationRecord) {
          if (get().status === "running") {
            return;
          }
          const current = get().evaluations;
          const evaluations = current.filter(e => e.id !== evaluation.id);
          if (evaluations.length === current.length) {
            return;
          }
          // Like removeRun, deleting an evaluation is not an undoable edit;
          // update the current history snapshot in place instead of recording
          // a new step.
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations,
            evaluationRubrics: get().evaluationRubrics
          });
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluations,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                (index === changeHistory.index ? thread : snapshot))
            }
          });
        },
        saveEvaluationRubric(input) {
          if (get().status === "running") {
            return null;
          }
          const result = upsertEvaluationRubric(get().evaluationRubrics, input);
          if (!result) {
            return null;
          }
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics: result.rubrics
          });
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluationRubrics: result.rubrics,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                (index === changeHistory.index ? thread : snapshot))
            }
          });
          return result.rubric;
        },
        removeEvaluationRubric(id) {
          if (get().status === "running") {
            return false;
          }
          const current = get().evaluationRubrics;
          const evaluationRubrics = current.filter(
            rubric => rubric.id !== id
          );
          if (evaluationRubrics.length === current.length) {
            return false;
          }
          const thread = withRunMetadata(get().thread, {
            runHistory: get().runHistory,
            evaluations: get().evaluations,
            evaluationRubrics
          });
          const changeHistory = get().changeHistory;
          set({
            thread,
            evaluationRubrics,
            changeHistory: {
              ...changeHistory,
              snapshots: changeHistory.snapshots.map((snapshot, index) =>
                (index === changeHistory.index ? thread : snapshot))
            }
          });
          return true;
        },
        abort() {
          const { status } = get();
          if (status !== "running") {
            return;
          }
          stopActiveRun?.();
        }
      };
    })
  );
}

export const ThreadStoreContext = createContext<ThreadStore | null>(null);

function useThreadStoreApi(): ThreadStore {
  const store = useContext(ThreadStoreContext);
  if (!store) { throw new Error("hooks must be used within <ThreadPlayground>"); }
  return store;
}

export function useThreadStore<T>(selector: (s: ThreadState) => T): T {
  return useStore(useThreadStoreApi(), selector);
}

const selectActions = (s: ThreadState) => ({
  run: s.run,
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
  updateToolCallOutputText: s.updateToolCallOutputTextContent,
  markToolCallAttempt: s.markToolCallAttempt,
  continueAfterProjectToolResult: s.continueAfterProjectToolResult,
  addTool: s.addTool,
  updateTool: s.updateTool,
  removeTool: s.removeTool,
  toggleMessageRole: s.toggleMessageRole,
  toggleMessageCollapsed: s.toggleMessageCollapsed
});
export function useThreadStoreActions() {
  return useStore(useThreadStoreApi(), useShallow(selectActions));
}
