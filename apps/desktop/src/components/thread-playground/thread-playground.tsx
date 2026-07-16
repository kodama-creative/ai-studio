"use client";

import {
  ChevronDownIcon,
  HistoryIcon,
  PlayIcon,
  Redo2Icon,
  Undo2Icon
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { usePanelRef } from "react-resizable-panels";

import type { AgentTransport, ProjectTool, Thread } from "@llm-space/core";

import {
  executeTool,
  type ToolExecutor
} from "@/client/tool-execution";
import { useRegisterCommands } from "@/commands";
import {
  resolveModelConfig,
  useDefaultModel,
  useFirstAvailableModel,
  useModels
} from "@/components/model-provider";
import { threadTitleFromPath } from "@/lib/thread-file";
import { cn } from "@/lib/utils";
import { MessageListView } from "./message/message-list-view";
import { ThreadPlaygroundSkeleton } from "./misc/skeleton";
import { TitleEditor, type TitleValidator } from "./misc/title-editor";
import { ModelConfigEditor } from "./model/model-config-editor";
import { SystemPromptEditor } from "./prompt/system-prompt-editor";
import { RunHistoryListView } from "./run-history-list-view";
import {
  canRedo,
  canUndo,
  createThreadStore,
  getAutoRunTools,
  getReactLoop,
  ThreadStoreContext,
  useRunMode,
  useThreadStore,
  useThreadStoreActions
} from "./stores";
import { ToolExecutionProvider } from "./tool-execution-context";
import { ToolListView } from "./tool/tool-list-view";
import { useShortcuts } from "./use-shortcuts";
import { useThreadPlaygroundEvents } from "./use-thread-playground-events";
import {
  listEnabledPromptVariableSkills,
  type PromptSkillsLoader,
  PromptSkillsProvider
} from "./variable/prompt-variable-skills";
import { PromptVariablesListView } from "./variable/prompt-variables-list-view";
import { Tooltip } from "../tooltip";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Kbd, KbdGroup } from "../ui/kbd";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "../ui/resizable";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";

export interface ThreadPlaygroundProps {
  readonly className?: string;
  readonly path: string;
  readonly title?: string;
  readonly headerDetails?: ReactNode;
  readonly initialValue: Thread;
  readonly readonly?: boolean;

  /** Block new model runs while leaving manual tool-result editing available. */
  readonly runDisabled?: boolean;

  /**
   * Whether this playground belongs to the active tab. Only the active one
   * registers the `runThread` command handler (the command registry keeps a
   * single handler per type), so a global run always targets the active tab.
   */
  readonly active?: boolean;

  /** The streaming transport used by runs (e.g. HTTP or Electrobun RPC). */
  readonly transport: AgentTransport;

  /** Execute a tool with owning-surface context such as a Project Thread id. */
  readonly toolExecutor?: ToolExecutor;

  /** Project-authored actions are source-owned and cannot be added/removed. */
  readonly toolsReadonly?: boolean;

  /** Navigate from a source-owned action chip to its authored file. */
  readonly onOpenProjectTool?: (tool: ProjectTool) => void;

  /** The transport executes tool batches and ReAct continuation itself. */
  readonly runtimeOwnsToolLoop?: boolean;

  /** Keep an unavailable saved model visible instead of resolving a fallback. */
  readonly preserveSavedModel?: boolean;

  /** Stamp runtime provenance into the durable run snapshot. */
  readonly prepareRunSnapshot?: (thread: Thread) => Thread;

  /** Immediately persist Runtime Run starts and settled boundaries. */
  readonly persistSettledThread?: (thread: Thread) => Promise<void>;

  /** Override local skill discovery for project-backed Threads. */
  readonly loadPromptSkills?: PromptSkillsLoader;

  /** Apply an owning-surface edit through the normal undo history. */
  readonly externalUpdate?: {
    revision: number;
    update: (thread: Thread) => Thread;
  };

  readonly onChange?: (thread: Thread) => void;
  readonly onRenameTitle?: (title: string) => Promise<boolean>;
  readonly validateTitle?: TitleValidator;
  readonly onStreamingStart?: () => void;
  readonly onStreamingEnd?: () => void;
}

export function ThreadPlayground({
  loading,
  initialValue,
  className,
  ...props
}: {
  readonly initialValue?: Thread | null;
  readonly loading?: boolean;
} & Omit<ThreadPlaygroundProps, "initialValue">) {
  if (loading) {
    return <ThreadPlaygroundSkeleton className={className} />;
  }
  if (!initialValue) {
    throw new Error("initialValue is required when not loading");
  }
  return (
    <_ThreadPlayground
      className={className}
      initialValue={initialValue}
      {...props}
    />
  );
}

const _ThreadPlayground = function ThreadPlayground({
  initialValue,
  transport,
  toolExecutor = executeTool,
  runtimeOwnsToolLoop,
  preserveSavedModel,
  prepareRunSnapshot,
  persistSettledThread,
  loadPromptSkills,
  externalUpdate,
  onChange,
  onStreamingStart,
  onStreamingEnd,
  ...props
}: ThreadPlaygroundProps) {
  // Keep live refs to the provider list and default model so the store can
  // resolve a thread's model (its own, else the default/first available) at
  // run/edit time without being recreated.
  const providers = useModels();
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const defaultModel = useDefaultModel();
  const defaultModelRef = useRef(defaultModel);
  defaultModelRef.current = defaultModel;
  const loadPromptSkillsRef = useRef(loadPromptSkills);
  loadPromptSkillsRef.current = loadPromptSkills;
  const prepareRunSnapshotRef = useRef(prepareRunSnapshot);
  prepareRunSnapshotRef.current = prepareRunSnapshot;
  const [store] = useState(() =>
    createThreadStore(initialValue, {
      transport,
      resolveModel: saved =>
        (preserveSavedModel && saved
          ? saved
          : resolveModelConfig(
            providersRef.current,
            saved,
            defaultModelRef.current
          )),
      getAutoRunTools,
      getReactLoop,
      loadPromptSkills: loadPromptSkills
        ? async () =>
          (loadPromptSkillsRef.current ?? listEnabledPromptVariableSkills)()
        : undefined,
      runtimeOwnsToolLoop,
      persistSettledThread,
      prepareRunSnapshot: thread =>
        prepareRunSnapshotRef.current?.(thread) ?? thread
    }));
  const appliedExternalRevision = useRef(0);
  useEffect(() => {
    if (
      !externalUpdate
      || externalUpdate.revision === appliedExternalRevision.current
    ) {
      return;
    }
    const apply = () => {
      if (store.getState().status === "running") { return false; }
      store
        .getState()
        .restoreThread(externalUpdate.update(store.getState().thread));
      appliedExternalRevision.current = externalUpdate.revision;
      return true;
    };
    if (apply()) { return; }
    const unsubscribe = store.subscribe(state => {
      if (state.status !== "idle" || !apply()) { return; }
      unsubscribe();
    });
    return unsubscribe;
  }, [externalUpdate, store]);
  useThreadPlaygroundEvents(store, {
    onChange,
    onStreamingStart,
    onStreamingEnd
  });
  return (
    <PromptSkillsProvider loader={loadPromptSkills}>
      <ToolExecutionProvider execute={toolExecutor}>
        <ThreadStoreContext.Provider value={store}>
          <ThreadPlaygroundContent
            {...props}
            preserveSavedModel={preserveSavedModel}
          />
        </ThreadStoreContext.Provider>
      </ToolExecutionProvider>
    </PromptSkillsProvider>
  );
};

/** Size the Run history panel expands to when toggled open. */
const RUN_HISTORY_PANEL_SIZE = "16rem";

function ThreadPlaygroundContent({
  className,
  path,
  title: titleFromProps,
  headerDetails,
  onRenameTitle,
  validateTitle,
  readonly: readonlyFromProps = false,
  runDisabled = false,
  active = false,
  preserveSavedModel = false,
  toolsReadonly = false,
  onOpenProjectTool
}: Omit<
  ThreadPlaygroundProps,
  | "externalUpdate"
  | "initialValue"
  | "loadPromptSkills"
  | "onChange"
  | "onStreamingEnd"
  | "onStreamingStart"
  | "transport"
>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const status = useThreadStore(s => s.status);
  const savedModel = useThreadStore(s => s.thread.model);
  const fallbackModel = useFirstAvailableModel();
  // A thread can run once a model resolves (its own, or the first available).
  const hasModel = Boolean(savedModel ?? fallbackModel);
  const undoable = useThreadStore(s => canUndo(s.changeHistory));
  const redoable = useThreadStore(s => canRedo(s.changeHistory));
  const { effectiveAutoRunTools, reactLoop, setAutoRunTools, setReactLoop } =
    useRunMode();
  const { run, abort, undo, redo, syncTitle } = useThreadStoreActions();
  const [systemPromptStreaming, setSystemPromptStreaming] = useState(false);
  const title = useMemo(
    () => titleFromProps ?? threadTitleFromPath(path),
    [path, titleFromProps]
  );
  useEffect(() => {
    syncTitle(title);
  }, [syncTitle, title]);
  const readonly = useMemo(() => {
    return readonlyFromProps || status === "running";
  }, [readonlyFromProps, status]);
  const handleRun = useCallback(async () => {
    if (runDisabled) { return; }
    await run();
  }, [run, runDisabled]);
  // Expose run as a command, but only from the active tab so a global
  // `runThread` targets it (and no-ops when no tab is active). Skip while
  // already running to avoid run()'s "already running" throw.
  useRegisterCommands(
    {
      runThread: () => {
        if (status !== "running" && !runDisabled) { void run(); }
      }
    },
    active
  );
  const handleStop = useCallback(() => {
    try {
      abort();
    } catch {
      // Ignored
    }
  }, [abort]);
  const runHistoryPanelRef = usePanelRef();
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => {
    const panel = runHistoryPanelRef.current;
    if (!panel) {
      return;
    }
    if (panel.isCollapsed()) {
      panel.resize(RUN_HISTORY_PANEL_SIZE);
    } else {
      panel.collapse();
    }
  }, [runHistoryPanelRef]);
  const closeHistory = useCallback(() => {
    runHistoryPanelRef.current?.collapse();
  }, [runHistoryPanelRef]);
  const handleShortcuts = useShortcuts({
    readonly: readonlyFromProps || (runDisabled && status !== "running")
  });
  return (
    <div
      className={cn("flex flex-col overflow-hidden", className)}
      onKeyDownCapture={handleShortcuts}
      ref={containerRef}
      tabIndex={0}
    >
      <ResizablePanelGroup>
        <ResizablePanel className="flex min-h-0 flex-col overflow-hidden">
          <header
            className={cn(
              "flex w-full shrink-0 items-center border-b",
              headerDetails ? "min-h-14 py-1.5" : "h-12"
            )}
          >
            <div className="min-w-0 grow px-3">
              <TitleEditor
                className="w-96 max-w-full"
                onRename={onRenameTitle}
                readonly={readonly || !onRenameTitle}
                title={title}
                validateTitle={validateTitle}
              />
              {headerDetails
                ? (
                  <div className="mt-0.5 flex min-w-0 items-center">
                    {headerDetails}
                  </div>
                )
                : null}
            </div>
            <div
              className={cn(
                "flex items-center gap-0.5 px-1",
                readonlyFromProps && "hidden"
              )}
            >
              <Tooltip content="Undo last edit">
                <Button
                  aria-label="Undo last edit"
                  disabled={readonly || !undoable}
                  onClick={undo}
                  size="icon-lg"
                  variant="ghost"
                >
                  <Undo2Icon className="size-4" />
                </Button>
              </Tooltip>
              <Tooltip content="Redo last edit">
                <Button
                  aria-label="Redo last edit"
                  disabled={readonly || !redoable}
                  onClick={redo}
                  size="icon-lg"
                  variant="ghost"
                >
                  <Redo2Icon className="size-4" />
                </Button>
              </Tooltip>
              <Tooltip content="View run history">
                <Button
                  aria-expanded={historyOpen}
                  aria-label={
                    historyOpen ? "Hide run history" : "View run history"
                  }
                  onClick={toggleHistory}
                  size="icon-lg"
                  variant="ghost"
                >
                  <HistoryIcon className="size-4" />
                </Button>
              </Tooltip>
            </div>
            <div className="flex items-center px-3">
              <ButtonGroup
                className={cn(
                  "transition-transform active:translate-y-px",
                  readonlyFromProps && "hidden"
                )}
              >
                <Tooltip
                  content={
                    <div>
                      {status === "running"
                        ? "Stop running"
                        : "Run this thread"}
                      <KbdGroup>
                        <Kbd className="text-foreground!">⌘ Enter</Kbd>
                      </KbdGroup>
                    </div>
                  }
                >
                  <Button
                    aria-label={
                      status === "running"
                        ? "Stop running thread"
                        : "Run thread"
                    }
                    className="border-r-primary border-none pr-1 pl-4 active:translate-y-0!"
                    disabled={
                      readonlyFromProps
                      || (status !== "running" && (!hasModel || runDisabled))
                    }
                    onClick={status === "running" ? handleStop : handleRun}
                  >
                    {status === "running"
                      ? (
                        <Spinner className="size-3" />
                      )
                      : (
                        <PlayIcon className="size-3" />
                      )}
                    {status === "running" ? "Stop" : "Run"}
                  </Button>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Run settings"
                      className="border-none pr-1.5 pl-0.5 active:translate-y-0!"
                      disabled={
                        readonlyFromProps
                        || (status !== "running" && (!hasModel || runDisabled))
                      }
                    >
                      <ChevronDownIcon className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    <DropdownMenuLabel>Run settings</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="justify-between gap-6"
                      onSelect={event => {
                        event.preventDefault();
                        setReactLoop(!reactLoop);
                      }}
                    >
                      Enable ReAct loop
                      <Switch
                        checked={reactLoop}
                        className="pointer-events-none"
                        size="sm"
                      />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="justify-between gap-6"
                      // The ReAct loop implies auto-running tools, so this row
                      // is forced on and locked while the loop is enabled.
                      disabled={reactLoop}
                      onSelect={event => {
                        // Keep the menu open so the switch toggles in place.
                        event.preventDefault();
                        setAutoRunTools(!effectiveAutoRunTools);
                      }}
                    >
                      Auto run tools
                      <Switch
                        checked={effectiveAutoRunTools}
                        className="pointer-events-none"
                        disabled={reactLoop}
                        size="sm"
                      />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            </div>
          </header>
          <ResizablePanelGroup
            className="flex min-h-0 grow"
            orientation="horizontal"
          >
            <ResizablePanel
              className="overflow-x-hidden pb-3"
              defaultSize="50%"
              minSize="300px"
              style={{ overflowX: "hidden" }}
            >
              <div className="flex size-full flex-col">
                <div className="px-3">
                  <div className="flex w-full border-b py-2">
                    <div className="text-muted-foreground w-20 shrink-0 text-sm">
                      Models
                    </div>
                    <div className="flex grow items-center">
                      <ModelConfigEditor
                        preserveSavedModel={preserveSavedModel}
                        readonly={readonly}
                      />
                    </div>
                  </div>
                  <div className="flex w-full border-b py-2">
                    <div className="text-muted-foreground w-20 shrink-0 text-sm">
                      Tools
                    </div>
                    <div className="flex grow items-center">
                      <ToolListView
                        onOpenProjectTool={onOpenProjectTool}
                        readonly={readonly || toolsReadonly}
                      />
                    </div>
                  </div>
                  <div className="flex w-full border-b py-2">
                    <div className="text-muted-foreground w-20 shrink-0 text-sm">
                      Variables
                    </div>
                    <div className="flex grow items-center">
                      <PromptVariablesListView
                        active={active}
                        disabled={readonly || systemPromptStreaming}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex min-h-0 w-full grow flex-col">
                  <SystemPromptEditor
                    className="size-full min-h-0 px-3"
                    onStreamingChange={setSystemPromptStreaming}
                    readonly={readonly}
                  />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle className="opacity-50 hover:opacity-100" />
            <ResizablePanel minSize="300px">
              <MessageListView readonly={readonly} runDisabled={runDisabled} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          collapsedSize={0}
          collapsible
          defaultSize={0}
          minSize={RUN_HISTORY_PANEL_SIZE}
          onResize={size => {
            setHistoryOpen(size.inPixels > 0);
          }}
          panelRef={runHistoryPanelRef}
        >
          <RunHistoryListView onClose={closeHistory} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
