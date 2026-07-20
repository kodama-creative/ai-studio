import { getThreadRuntimeProfile } from "@llm-space/core";
import { agentModelMatchesDefinition } from "@llm-space/runtime";
import {
  AlertTriangleIcon,
  BotIcon,
  CableIcon,
  RefreshCwIcon,
  XIcon
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import type {
  ProjectTool,
  Thread,
  ThreadAgentRuntimeProvenance,
  ThreadServerRunLineage
} from "@llm-space/core";
import type { StoredRuntimeSession } from "@llm-space/runtime/harness";

import { createRpcTransport, externalAgentProjects } from "@/client";
import {
  executeTool,
  type ToolExecutor
} from "@/client/tool-execution";
import { useCommands, useRegisterCommands } from "@/commands";
import {
  CodeEditor,
  type CodeEditorHandle,
  type CodeEditorLanguage
} from "@/components/code-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useModels } from "@/components/model-provider";
import { ThreadPlayground } from "@/components/thread-playground";
import { RuntimeProfileControl } from "@/components/thread-playground/runtime-profile-control";
import { getRuntimeExecutionMode } from "@/components/thread-playground/stores/run-mode";
import { Button } from "@/components/ui/button";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import {
  type ExternalAgentProjectConnectionActivation,
  type ExternalAgentProjectRunBlockReason,
  type ExternalAgentProjectRuntimeStatus,
  type ExternalAgentProjectThreadRecord,
  type ExternalAgentProjectView,
  getExternalAgentProjectRunBlockReason,
  hasPendingExternalAgentProjectToolResult
} from "@/shared/external-agent-project";
import {
  consumeExternalProjectSource,
  subscribeExternalProjectSource
} from "./external-project-source-navigation";
import { registerTabCloseGuard, setTabDirty } from "./tab-close-guards";

const _ExternalProjectTabPane = function ExternalProjectTabPane({
  tabId,
  projectId,
  threadId,
  active,
  refreshNonce
}: {
  readonly active: boolean;
  readonly projectId: string;
  readonly refreshNonce: number;
  readonly tabId: string;
  readonly threadId?: string;
}) {
  return (
    <section className={cn("absolute inset-0", !active && "hidden")}>
      {threadId
        ? (
          <_ProjectThreadPane
            active={active}
            projectId={projectId}
            refreshNonce={refreshNonce}
            threadId={threadId}
          />
        )
        : (
          <_ProjectBuildPane
            active={active}
            projectId={projectId}
            refreshNonce={refreshNonce}
            tabId={tabId}
          />
        )}
    </section>
  );
};

const _ProjectThreadPane = function ProjectThreadPane({
  projectId,
  threadId,
  active,
  refreshNonce
}: {
  readonly active: boolean;
  readonly projectId: string;
  readonly refreshNonce: number;
  readonly threadId: string;
}) {
  const [project, setProject] = useState<ExternalAgentProjectView | null>(null);
  const [record, setRecord] = useState<ExternalAgentProjectThreadRecord | null>(
    null
  );
  const [connectionActivation, setConnectionActivation] =
    useState<ExternalAgentProjectConnectionActivation | null>(null);
  const [externalUpdate, setExternalUpdate] = useState<{
    revision: number;
    update: (thread: Thread) => Thread;
  }>();
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runtimeStatus, setRuntimeStatus] =
    useState<ExternalAgentProjectRuntimeStatus>({ state: "ready" });
  const [sandboxStatus, setSandboxStatus] =
    useState<ExternalAgentProjectRuntimeStatus>({
      state: "unavailable",
      message: "Checking Docker Engine availability."
    });
  const [inspectRunRequest, setInspectRunRequest] = useState<{
    revision: number;
    runId: string;
  }>();
  const providers = useModels();
  const { executeCommand } = useCommands();
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ExternalAgentProjectThreadRecord | null>(null);
  const recordRef = useRef(record);
  const projectRef = useRef(project);
  const activeRunProvenance = useRef<ThreadAgentRuntimeProvenance | null>(null);
  const activeRuntimeSession = useRef<StoredRuntimeSession | null>(null);
  const activeServerRun = useRef<{
    lineage: ThreadServerRunLineage;
    terminalOutcome?: "cancelled" | "completed" | "failed" | "outcomeUnknown";
  } | null>(null);
  recordRef.current = record;
  projectRef.current = project;
  const runtimeTransport = useMemo(
    () =>
      createRpcTransport({
        runtime: () => {
          activeRuntimeSession.current = null;
          const current = recordRef.current?.thread;
          return current
            && getThreadRuntimeProfile(current).type === "localServer"
            ? {
              type: "localServerAgentProject" as const,
              projectId,
              threadId
            }
            : {
              type: "agentProject" as const,
              projectId,
              threadId,
              modelSource:
                  current?.agentRuntime?.modelSource ?? "threadOverride",
              executionMode: getRuntimeExecutionMode()
            };
        },
        settleAbort: () => {
          const current = recordRef.current?.thread;
          return Boolean(
            current
            && getThreadRuntimeProfile(current).type === "localServer"
          );
        },
        onRuntimeResolved: runtime => {
          activeRunProvenance.current = runtime;
        },
        onRuntimeSessionCommitted: session => {
          activeRuntimeSession.current = session;
        },
        onLocalServerStatus: status => {
          setRuntimeStatus(status);
        },
        onLocalServerLineage: (lineage, terminalOutcome) => {
          activeServerRun.current = { lineage, terminalOutcome };
        }
      }),
    [projectId, threadId]
  );
  const projectToolExecutor: ToolExecutor = useCallback(
    async (tool, args, context) =>
      executeTool(tool, args, { ...context, threadId }),
    [threadId]
  );

  const flush = useCallback(async () => {
    if (writeTimer.current) { clearTimeout(writeTimer.current); }
    writeTimer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) {
      await externalAgentProjects.writeThread(projectId, threadId, next);
    }
  }, [projectId, threadId]);

  const load = useCallback(async () => {
    await flush();
    try {
      const [nextProject, nextRecord, nextSandboxStatus] = await Promise.all([
        externalAgentProjects.inspect(projectId),
        externalAgentProjects.readThread(projectId, threadId),
        externalAgentProjects.sandboxStatus(threadId)
      ]);
      const nextProfile = getThreadRuntimeProfile(nextRecord.thread);
      const nextActivation =
        nextProject.status === "ready" && nextProfile.type !== "localServer"
          ? await externalAgentProjects.activateConnections(
            projectId,
            threadId
          )
          : null;
      const nextRuntimeStatus = nextProfile.type === "localServer"
        || nextProfile.type === "desktopSandbox"
        ? await externalAgentProjects.runtimeStatus(projectId, threadId)
        : nextProject.sandboxRequired
          ? {
            state: "stale" as const,
            message: "The latest Agent requires Sandbox. Create a new Desktop Sandbox Thread."
          }
          : { state: "ready" as const };
      setConnectionActivation(nextActivation);
      setSandboxStatus(nextSandboxStatus);
      setRuntimeStatus(nextRuntimeStatus);
      setProject(nextProject);
      if (
        recordRef.current
        && JSON.stringify(recordRef.current.thread)
        !== JSON.stringify(nextRecord.thread)
      ) {
        setExternalUpdate(current => ({
          revision: (current?.revision ?? 0) + 1,
          update: thread => ({
            ...thread,
            context: {
              ...thread.context,
              tools: nextRecord.thread.context?.tools
            }
          })
        }));
      }
      setRecord(nextRecord);
    } catch (error) {
      toast.error("Unable to open project Thread", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  }, [flush, projectId, threadId]);

  useEffect(() => {
    if (!active) { return; }
    void load();
    return () => {
      void flush();
      void externalAgentProjects.deactivateConnections(projectId, threadId);
    };
  }, [active, load, flush, projectId, refreshNonce, threadId]);

  const refreshProject = useCallback(
    async (runEnded = false) => {
      if (!active) { return; }
      if (running && !runEnded) { return; }
      const current = pending.current ?? recordRef.current;
      if (current && hasPendingExternalAgentProjectToolResult(current)) {
        setProject(await externalAgentProjects.inspect(projectId));
        return;
      }
      await load();
    },
    [active, load, projectId, running]
  );

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) { return; }
    const listener = ({ projectId: changed }: { projectId: string; }) => {
      if (changed === projectId) { void refreshProject(); }
    };
    rpc.addMessageListener("externalAgentProjectChanged", listener);
    return () => { rpc.removeMessageListener("externalAgentProjectChanged", listener); };
  }, [projectId, refreshProject]);

  const handleChange = useCallback(
    (thread: Thread) => {
      const current = recordRef.current;
      if (!current) { return; }
      const modelChanged = !_sameRuntimeModel(
        current.thread.model,
        thread.model
      );
      const nextThread = modelChanged
        ? {
          ...thread,
          agentRuntime: {
            projectId,
            snapshot:
                thread.agentRuntime?.snapshot ?? project?.snapshot ?? "",
            definitionFingerprint:
                thread.agentRuntime?.definitionFingerprint
                ?? project?.definitionFingerprint
                ?? "",
            modelSource: "threadOverride" as const
          }
        }
        : thread;
      const next = { ...current, thread: nextThread };
      setRecord(next);
      pending.current = next;
      if (writeTimer.current) { clearTimeout(writeTimer.current); }
      writeTimer.current = setTimeout(() => void flush(), 500);
    },
    [flush, project, projectId]
  );

  const persistSettledThread = useCallback(
    async (thread: Thread) => {
      handleChange(thread);
      await flush();
    },
    [flush, handleChange]
  );

  const handleRename = useCallback(
    async (title: string) => {
      const current = recordRef.current;
      if (!current) { return false; }
      const next = { ...current, thread: { ...current.thread, title } };
      setRecord(next);
      pending.current = next;
      await flush();
      return true;
    },
    [flush]
  );

  const selectRuntimeProfile = useCallback(
    (type: "desktopDirect" | "desktopSandbox" | "localServer") => {
      const current = recordRef.current;
      if (!current) {
        return;
      }
      const currentProfile = getThreadRuntimeProfile(current.thread);
      if (currentProfile.type === type) {
        return;
      }
      executeCommand({
        type: "createExternalAgentProjectThread",
        args: { projectId, runtimeProfileType: type }
      });
    },
    [executeCommand, projectId]
  );

  const syncFromAgent = useCallback(async () => {
    await flush();
    const next = await externalAgentProjects.syncThreadFromAgent(
      projectId,
      threadId
    );
    const nextActivation = await externalAgentProjects.activateConnections(
      projectId,
      threadId
    );
    setConnectionActivation(nextActivation);
    setRecord(next);
    setExternalUpdate(current => ({
      revision: (current?.revision ?? 0) + 1,
      update: thread => ({
        ...thread,
        model: next.thread.model,
        context: {
          ...thread.context,
          systemPrompt: next.thread.context?.systemPrompt,
          tools: next.thread.context?.tools
        }
      })
    }));
  }, [flush, projectId, threadId]);

  useRegisterCommands(
    {
      syncExternalAgentProjectThreadFromAgent: async ({
        projectId: commandProjectId,
        threadId: commandThreadId
      }) => {
        if (
          commandProjectId === projectId
          && commandThreadId === threadId
          && !running
        ) {
          return syncFromAgent();
        }
      },
      retryExternalAgentProjectConnections: async ({
        projectId: commandProjectId,
        threadId: commandThreadId
      }) => {
        if (
          commandProjectId === projectId
          && commandThreadId === threadId
          && !running
        ) {
          return load();
        }
      },
      retryExternalAgentProjectRuntime: async ({
        projectId: commandProjectId,
        threadId: commandThreadId
      }) => {
        if (
          commandProjectId === projectId
          && commandThreadId === threadId
          && !running
        ) {
          setRuntimeStatus(
            await externalAgentProjects.runtimeStatus(projectId, threadId)
          );
        }
      }
    },
    active
  );
  const loadPromptSkills = useCallback(
    async () => Promise.resolve(project?.skills ?? []),
    [project?.skills]
  );
  const stageSandboxFiles = useCallback(
    async (messageId: string) => externalAgentProjects.stageSandboxFiles(
      projectId,
      threadId,
      messageId
    ),
    [projectId, threadId]
  );
  const openProjectToolSource = useCallback(
    (tool: ProjectTool) => {
      if (!project || !tool.sourcePath) { return; }
      executeCommand({
        type: "openExternalAgentProjectSource",
        args: {
          projectId,
          projectPath: project.path,
          projectName: project.name,
          sourcePath: tool.sourcePath
        }
      });
    },
    [executeCommand, project, projectId]
  );
  const prepareRunSnapshot = useCallback(
    (thread: Thread): Thread => {
      const profile = getThreadRuntimeProfile(thread);
      if (profile.type === "localServer") {
        const serverRun = activeServerRun.current;
        const { runtimeSession: _runtimeSession, ...withoutRuntimeSession } =
          thread;
        return {
          ...withoutRuntimeSession,
          runtimeProfile: {
            ...profile,
            ...(serverRun
              ? { serverSessionId: serverRun.lineage.sessionId }
              : {})
          },
          agentRuntime: {
            projectId,
            snapshot: project?.snapshot ?? thread.agentRuntime?.snapshot ?? "",
            definitionFingerprint:
              project?.definitionFingerprint
              ?? thread.agentRuntime?.definitionFingerprint
              ?? "",
            modelSource: "agent"
          }
        };
      }
      const frozen = activeRunProvenance.current ?? {
        projectId,
        snapshot: project?.snapshot ?? "",
        definitionFingerprint: project?.definitionFingerprint ?? "",
        modelSource:
          recordRef.current?.thread.agentRuntime?.modelSource
          ?? (agentModelMatchesDefinition({
            model: thread.model,
            reasoning: thread.model?.params?.reasoning,
            definition: project?.definition
          })
            ? "agent"
            : "threadOverride")
      };
      return {
        ...thread,
        agentRuntime: {
          projectId: frozen.projectId,
          snapshot: frozen.snapshot,
          definitionFingerprint: frozen.definitionFingerprint,
          modelSource: frozen.modelSource
        }
      };
    },
    [project, projectId]
  );
  const handleStreamingStart = useCallback(() => {
    activeServerRun.current = null;
    setRuntimeStatus({ state: "running" });
    activeRunProvenance.current = project
      ? {
        projectId,
        snapshot: project.snapshot,
        definitionFingerprint: project.definitionFingerprint,
        modelSource:
            recordRef.current?.thread.agentRuntime?.modelSource
            ?? (recordRef.current
              && agentModelMatchesDefinition({
                model: recordRef.current.thread.model,
                reasoning: recordRef.current.thread.model?.params?.reasoning,
                definition: project.definition
              })
              ? "agent"
              : "threadOverride")
      }
      : null;
    setRunning(true);
  }, [project, projectId]);
  const handleStreamingEnd = useCallback((thread: Thread) => {
    setRunning(false);
    setRuntimeStatus(current =>
      (current.state === "stale" || current.state === "unavailable"
        ? current
        : { state: "ready" }));
    const serverRun = activeServerRun.current;
    if (serverRun) {
      const snapshot = thread.runHistory?.find(
        run => run.runtime?.runId === serverRun.lineage.runId
      );
      const snapshotId = snapshot?.id;
      if (snapshotId) {
        setInspectRunRequest(current => ({
          revision: (current?.revision ?? 0) + 1,
          runId: snapshotId
        }));
      }
    }
    queueMicrotask(() => {
      activeRunProvenance.current = null;
      void refreshProject(true);
    });
  }, [refreshProject]);

  const resolveTransportRuntimeCheckpoint = useCallback(
    (outcome:
      | "cancelled"
      | "completed"
      | "failed"
      | "outcomeUnknown") => {
      const serverRun = activeServerRun.current;
      if (!serverRun) {
        return null;
      }
      const state = serverRun.terminalOutcome
        ?? (outcome === "cancelled" ? "cancelled" : "outcomeUnknown");
      const selectedOutput = projectRef.current?.outputs.find(
        output => output.name === recordRef.current?.thread.outputContract
      );
      return {
        runId: serverRun.lineage.runId,
        state,
        checkpointOrder: 1,
        continuationFingerprint: [
          "local-server",
          serverRun.lineage.artifactFingerprint,
          serverRun.lineage.sessionId,
          serverRun.lineage.runId
        ].join(":"),
        server: serverRun.lineage,
        ...(selectedOutput
          ? {
            outputContract: {
              name: selectedOutput.name,
              schemaFingerprint: selectedOutput.schemaFingerprint
            }
          }
          : {})
      };
    },
    []
  );

  const localServer = record
    ? getThreadRuntimeProfile(record.thread).type === "localServer"
    : false;
  const desktopSandbox = record
    ? getThreadRuntimeProfile(record.thread).type === "desktopSandbox"
    : false;
  const awaitingToolResult = record
    ? hasPendingExternalAgentProjectToolResult(record)
    : false;
  const runBlockReason: ExternalAgentProjectRunBlockReason | null =
    project && record
      ? (localServer ? null : getExternalAgentProjectRunBlockReason(project, record))
      : "sourceUnavailable";
  const savedModelAvailable = useMemo(() => {
    if (localServer) { return true; }
    const model = record?.thread.model;
    if (!model) { return false; }
    const provider = providers.find(
      candidate => candidate.id === model.provider
    );
    return Boolean(
      provider
      && !provider.disabledModels?.includes(model.id)
      && provider.models.some(candidate => candidate.id === model.id)
    );
  }, [localServer, providers, record?.thread.model]);
  useEffect(() => {
    if (runBlockReason === "staleToolSnapshot") {
      void refreshProject();
    }
  }, [refreshProject, runBlockReason]);

  if (!project || !record) {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
        Loading project Thread…
      </div>
    );
  }
  if (
    project.status !== "ready"
    && !localServer
    && !running
    && !awaitingToolResult
  ) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangleIcon className="text-destructive size-7" />
        <h2 className="font-medium">Invalid Agent Project</h2>
        <p className="text-muted-foreground max-w-xl text-sm whitespace-pre-wrap">
          {project.error}
        </p>
        <Button
          onClick={() => {
            executeCommand({
              type: "refreshExternalAgentProject",
              args: { projectId }
            });
          }}
        >
          <RefreshCwIcon /> Refresh
        </Button>
      </div>
    );
  }

  const promptLocallyChanged =
    (record.thread.context?.systemPrompt ?? "") !== record.syncedPrompt;
  const currentReasoning = record.thread.model?.params?.reasoning;
  const modelValueChanged =
    record.thread.model?.provider !== record.syncedDefinition.model.provider
    || record.thread.model?.id !== record.syncedDefinition.model.id;
  const reasoningValueChanged =
    currentReasoning !== record.syncedDefinition.reasoning;
  const provenanceOnlyModelOverride =
    record.thread.agentRuntime?.modelSource === "threadOverride"
    && !modelValueChanged
    && !reasoningValueChanged;
  const modelLocallyChanged = modelValueChanged || provenanceOnlyModelOverride;
  const reasoningLocallyChanged = reasoningValueChanged;
  const definitionLocallyChanged =
    modelLocallyChanged || reasoningLocallyChanged;
  const locallyChanged = promptLocallyChanged || definitionLocallyChanged;
  const agentOutOfSync =
    !localServer
    && (record.promptFingerprint !== project.promptFingerprint
      || record.definitionFingerprint !== project.definitionFingerprint
      || locallyChanged
      || connectionActivation?.hasSchemaDrift === true);
  const replacedFields = [
    ...(promptLocallyChanged ? ["instructions"] : []),
    ...(modelLocallyChanged ? ["model"] : []),
    ...(reasoningLocallyChanged ? ["reasoning"] : [])
  ];
  const unavailableConnections =
    connectionActivation?.statuses.filter(
      status => status.state === "unavailable"
    ) ?? [];
  const driftedConnections =
    connectionActivation?.statuses.filter(status => status.state === "drift")
    ?? [];
  const runtimeProfile = getThreadRuntimeProfile(record.thread);
  return (
    <>
      <ThreadPlayground
        active={active}
        className="bg-background size-full"
        configurationReadonly={localServer}
        externalUpdate={externalUpdate}
        headerDetails={
          <div className="flex min-w-0 items-center gap-2 text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1 truncate">
              <BotIcon className="size-3" /> {project.name}
              {project.status === "ready"
                ? null
                : " · Source invalid; current run is frozen"}
            </span>
            <RuntimeProfileControl
              disabled={running}
              onSelect={selectRuntimeProfile}
              profile={runtimeProfile}
              sandboxRequired={project.sandboxRequired}
              sandboxStatus={sandboxStatus}
              status={runtimeStatus}
            />
            {runtimeStatus.message
              && (runtimeStatus.state === "stale"
                || runtimeStatus.state === "unavailable")
              ? (
                <span
                  className="text-destructive hidden min-w-0 truncate min-[1200px]:inline"
                  title={runtimeStatus.message}
                >
                  {runtimeStatus.message}
                </span>
              )
              : null}
            <span className="text-muted-foreground hidden shrink-0 min-[1100px]:inline">
              {locallyChanged ? "Thread override" : "From Agent"}
            </span>
            {!savedModelAvailable
              ? (
                <span className="text-destructive flex shrink-0 items-center gap-1">
                  <AlertTriangleIcon className="size-3" /> Model unavailable
                </span>
              )
              : null}
            {agentOutOfSync && runBlockReason !== "sandboxRequired"
              ? (
                <Button
                  className="h-5 px-1.5 text-[10px]"
                  disabled={running || project.status !== "ready"}
                  onClick={() => {
                    if (locallyChanged) {
                      setSyncConfirmOpen(true);
                    } else {
                      executeCommand({
                        type: "syncExternalAgentProjectThreadFromAgent",
                        args: { projectId, threadId }
                      });
                    }
                  }}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCwIcon className="size-3" /> Sync from Agent
                </Button>
              )
              : null}
            {((localServer || desktopSandbox)
              && runtimeStatus.state === "stale")
            || runBlockReason === "sandboxRequired"
              ? (
                <Button
                  className="h-5 px-1.5 text-[10px]"
                  onClick={() => {
                    executeCommand({
                      type: "createExternalAgentProjectThread",
                      args: {
                        projectId,
                        runtimeProfileType: localServer
                          ? "localServer"
                          : "desktopSandbox"
                      }
                    });
                  }}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCwIcon className="size-3" />
                  <span className="hidden min-[1100px]:inline">
                    Create thread for latest artifact
                  </span>
                  <span className="min-[1100px]:hidden">New thread</span>
                </Button>
              )
              : (localServer || desktopSandbox)
                && runtimeStatus.state === "unavailable"
                ? (
                  <Button
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() => {
                      executeCommand({
                        type: "retryExternalAgentProjectRuntime",
                        args: { projectId, threadId }
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCwIcon className="size-3" /> Retry
                  </Button>
                )
                : null}
            {driftedConnections.length > 0
              ? (
                <span className="text-destructive flex shrink-0 items-center gap-1">
                  <CableIcon className="size-3" /> Remote actions changed
                </span>
              )
              : unavailableConnections.length > 0
                ? (
                  <Button
                    className="h-5 px-1.5 text-[10px]"
                    disabled={running || project.status !== "ready"}
                    onClick={() => {
                      executeCommand({
                        type: "retryExternalAgentProjectConnections",
                        args: { projectId, threadId }
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCwIcon className="size-3" /> Retry connections
                  </Button>
                )
                : null}
          </div>
        }
        initialValue={record.thread}
        inspectRunRequest={inspectRunRequest}
        key={runtimeProfile.type}
        loadPromptSkills={loadPromptSkills}
        messageEditingMode={localServer ? "appendTextOnly" : "full"}
        messagesReadonly={localServer
          ? runtimeStatus.state === "stale"
          : false}
        onChange={handleChange}
        onOpenProjectTool={openProjectToolSource}
        onRenameTitle={handleRename}
        onStreamingEnd={handleStreamingEnd}
        onStreamingStart={handleStreamingStart}
        outputDefinitions={project.outputs}
        outputReadonly={localServer ? runtimeStatus.state === "stale" : false}
        path={`project/${projectId}/${threadId}.json`}
        persistSettledThread={persistSettledThread}
        prepareRunSnapshot={prepareRunSnapshot}
        preserveSavedModel
        renderPromptVariables={!localServer}
        resolveCommittedRuntimeSession={
          localServer
            ? undefined
            : () => activeRuntimeSession.current ?? undefined
        }
        resolveTransportRuntimeCheckpoint={
          localServer ? resolveTransportRuntimeCheckpoint : undefined
        }
        runDisabled={
          runBlockReason !== null
          || !savedModelAvailable
          || (!localServer && connectionActivation?.hasSchemaDrift === true)
          || ((localServer || desktopSandbox)
            && runtimeStatus.state !== "ready"
            && runtimeStatus.state !== "running")
          || (localServer && !_isLocalServerDraftReady(record.thread))
        }
        runSettingsReadonly={localServer}
        runtimeOwnsToolLoop
        stageSandboxFiles={desktopSandbox ? stageSandboxFiles : undefined}
        title={record.thread.title ?? "untitled"}
        toolExecutor={projectToolExecutor}
        toolsReadonly
        transport={runtimeTransport}
        transportOwnsRuntimeRun={localServer}
      />
      <ConfirmDialog
        confirmLabel="Sync from Agent"
        description={`This replaces this Thread’s ${replacedFields.join(", ")} with the latest Agent values. You can undo the change after syncing.`}
        onConfirm={() => {
          setSyncConfirmOpen(false);
          executeCommand({
            type: "syncExternalAgentProjectThreadFromAgent",
            args: { projectId, threadId }
          });
        }}
        onOpenChange={setSyncConfirmOpen}
        open={syncConfirmOpen}
        title="Sync settings from Agent?"
      />
    </>
  );
};

const _ProjectBuildPane = function ProjectBuildPane({
  tabId,
  projectId,
  active,
  refreshNonce
}: {
  readonly active: boolean;
  readonly projectId: string;
  readonly refreshNonce: number;
  readonly tabId: string;
}) {
  const [project, setProject] = useState<ExternalAgentProjectView | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Map<string, SourceBuffer>>(new Map());
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [closeResolver, setCloseResolver] = useState<
    ((allow: boolean) => void) | null
  >(null);
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const draftsRef = useRef(new Map<string, string>());
  const editorRef = useRef<CodeEditorHandle>(null);
  const initializedRef = useRef(false);
  const { executeCommand } = useCommands();
  const updateBuffer = useCallback(
    (path: string, update: (buffer: SourceBuffer) => SourceBuffer) => {
      setBuffers(current => {
        const buffer = current.get(path);
        if (!buffer) { return current; }
        const nextBuffer = update(buffer);
        if (nextBuffer === buffer) { return current; }
        const next = new Map(current);
        next.set(path, nextBuffer);
        return next;
      });
    },
    []
  );

  const openSource = useCallback(
    async (path: string) => {
      setOpenFiles(current =>
        (current.includes(path) ? current : [...current, path]));
      setActiveFile(path);
      if (buffersRef.current.has(path)) { return; }
      setBuffers(current => {
        if (current.has(path)) { return current; }
        const next = new Map(current);
        next.set(path, {
          path,
          text: "",
          savedText: "",
          diskText: "",
          dirty: false,
          conflict: false,
          loading: true,
          revision: 0
        });
        return next;
      });
      try {
        const { text } = await externalAgentProjects.readSource(
          projectId,
          path
        );
        draftsRef.current.set(path, text);
        updateBuffer(path, buffer => ({
          ...buffer,
          text,
          savedText: text,
          diskText: text,
          loading: false
        }));
      } catch (error) {
        updateBuffer(path, buffer => ({
          ...buffer,
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        }));
        toast.error("Unable to read Agent source", {
          description: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [projectId, updateBuffer]
  );

  useEffect(
    () =>
      subscribeExternalProjectSource(projectId, path => {
        consumeExternalProjectSource(projectId, path);
        initializedRef.current = true;
        void openSource(path);
      }),
    [openSource, projectId]
  );

  const loadProject = useCallback(async () => {
    const next = await externalAgentProjects.inspect(projectId);
    setProject(next);
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (next.sourceFiles.includes("instructions.md")) {
        void openSource("instructions.md");
      }
    }
    const paths = openFilesRef.current.filter(path =>
      next.sourceFiles.includes(path));
    await Promise.all(
      paths.map(async path => {
        const { text: diskText } = await externalAgentProjects.readSource(
          projectId,
          path
        );
        const buffer = buffersRef.current.get(path);
        if (!buffer || buffer.loading) { return; }
        const draft = draftsRef.current.get(path) ?? buffer.text;
        if (buffer.dirty) {
          if (diskText !== buffer.diskText) {
            updateBuffer(path, current => ({
              ...current,
              diskText,
              conflict: true
            }));
          }
        } else if (diskText !== buffer.diskText) {
          draftsRef.current.set(path, diskText);
          updateBuffer(path, current => ({
            ...current,
            text: diskText,
            savedText: diskText,
            diskText,
            dirty: false,
            conflict: false,
            error: undefined,
            revision: current.revision + 1
          }));
        } else if (draft !== buffer.text) {
          draftsRef.current.set(path, buffer.text);
        }
      })
    );
  }, [openSource, projectId, updateBuffer]);

  useEffect(() => {
    void loadProject();
  }, [loadProject, refreshNonce]);

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) { return; }
    const listener = ({ projectId: changed }: { projectId: string; }) => {
      if (changed === projectId) { void loadProject(); }
    };
    rpc.addMessageListener("externalAgentProjectChanged", listener);
    return () => { rpc.removeMessageListener("externalAgentProjectChanged", listener); };
  }, [loadProject, projectId]);

  const hasDirtyBuffers = [...buffers.values()].some(buffer => buffer.dirty);
  useEffect(() => {
    setTabDirty(tabId, hasDirtyBuffers);
  }, [hasDirtyBuffers, tabId]);

  const discardAll = useCallback(() => {
    setBuffers(current => {
      const next = new Map(current);
      for (const [path, buffer] of current) {
        if (!buffer.dirty && !buffer.conflict) { continue; }
        draftsRef.current.set(path, buffer.diskText);
        next.set(path, {
          ...buffer,
          text: buffer.diskText,
          savedText: buffer.diskText,
          dirty: false,
          conflict: false,
          error: undefined,
          revision: buffer.revision + 1
        });
      }
      return next;
    });
  }, []);

  useEffect(
    () =>
      registerTabCloseGuard(tabId, async () => {
        if (![...buffersRef.current.values()].some(buffer => buffer.dirty)) {
          return Promise.resolve(true);
        }
        return new Promise<boolean>(resolve => { setCloseResolver(() => resolve); });
      }),
    [tabId]
  );

  const saveSource = useCallback(
    async (path: string, nextText: string, overwrite = false) => {
      const buffer = buffersRef.current.get(path);
      if (!buffer || (buffer.conflict && !overwrite)) { return; }
      try {
        await externalAgentProjects.writeSource(projectId, path, nextText);
        draftsRef.current.set(path, nextText);
        updateBuffer(path, current => ({
          ...current,
          text: nextText,
          savedText: nextText,
          diskText: nextText,
          dirty: false,
          conflict: false,
          error: undefined
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateBuffer(path, current => ({ ...current, error: message }));
        toast.error("Unable to save Agent source", { description: message });
      }
    },
    [projectId, updateBuffer]
  );

  useRegisterCommands(
    {
      saveExternalAgentProjectSource: async ({
        projectId: commandProjectId,
        path,
        text: nextText,
        overwrite
      }) => {
        if (commandProjectId !== projectId) { return; }
        await saveSource(path, nextText, overwrite);
      }
    },
    active
  );

  const closeSource = useCallback((path: string) => {
    const current = openFilesRef.current;
    const index = current.indexOf(path);
    if (index === -1) { return; }
    const next = current.filter(candidate => candidate !== path);
    setOpenFiles(next);
    setActiveFile(activePath =>
      (activePath === path
        ? (next[index] ?? next[index - 1] ?? null)
        : activePath));
    draftsRef.current.delete(path);
    setBuffers(currentBuffers => {
      const nextBuffers = new Map(currentBuffers);
      nextBuffers.delete(path);
      return nextBuffers;
    });
  }, []);

  const requestCloseSource = useCallback(
    (path: string) => {
      if (buffersRef.current.get(path)?.dirty) { setPendingClose(path); } else { closeSource(path); }
    },
    [closeSource]
  );

  const activeBuffer = activeFile ? buffers.get(activeFile) : undefined;
  const activeText = activeFile
    ? (draftsRef.current.get(activeFile) ?? activeBuffer?.text ?? "")
    : "";

  if (!project) { return null; }
  return (
    <div
      className="flex size-full min-h-0 flex-col"
      data-agent-build={projectId}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <BotIcon className="text-primary size-4" />
        <span className="text-sm font-medium">{project.name}</span>
        {project.status === "ready"
          ? null
          : (
            <span className="text-destructive ml-auto text-xs">
              {project.status}
            </span>
          )}
        <Button
          className={cn(project.status === "ready" && "ml-auto")}
          disabled={
            !activeFile || !activeBuffer?.dirty || activeBuffer.conflict
          }
          onClick={() => {
            if (activeFile) {
              executeCommand({
                type: "saveExternalAgentProjectSource",
                args: {
                  projectId,
                  path: activeFile,
                  text: editorRef.current?.getValue() ?? activeText
                }
              });
            }
          }}
          size="sm"
          variant="outline"
        >
          Save
        </Button>
      </header>
      {project.error
        ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive border-b px-3 py-2 text-xs whitespace-pre-wrap">
            {project.error}
          </div>
        )
        : null}
      <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r p-2">
          <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wide uppercase">
            Agent source
          </p>
          {project.sourceFiles.map(file => (
            <button
              className={cn(
                "focus-visible:ring-ring/30 w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs outline-none focus-visible:ring-2",
                file === activeFile
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              )}
              key={file}
              onClick={() => void openSource(file)}
              title={file}
              type="button"
            >
              {file}
            </button>
          ))}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          {openFiles.length > 0
            ? (
              <div
                aria-label="Open Agent source files"
                className="flex h-9 shrink-0 overflow-x-auto border-b"
                role="tablist"
              >
                {openFiles.map(file => {
                  const buffer = buffers.get(file);
                  return (
                    <div
                      className={cn(
                        "group flex shrink-0 items-center border-r",
                        file === activeFile && "bg-muted"
                      )}
                      key={file}
                    >
                      <button
                        aria-selected={file === activeFile}
                        className="flex h-full items-center gap-1.5 px-3 font-mono text-xs"
                        onClick={() => { setActiveFile(file); }}
                        role="tab"
                        title={file}
                        type="button"
                      >
                        <span>{file}</span>
                        {buffer?.dirty
                          ? (
                            <span
                              aria-label="Unsaved changes"
                              className="text-primary"
                            >
                              ●
                            </span>
                          )
                          : null}
                      </button>
                      <Button
                        aria-label={`Close ${file}`}
                        className="mr-1 size-5 opacity-70 group-hover:opacity-100"
                        onClick={() => { requestCloseSource(file); }}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )
            : null}
          {activeFile && activeBuffer
            ? (
              <>
                {activeBuffer.conflict
                  ? (
                    <div className="border-warning/40 bg-warning/5 flex items-center gap-2 border-b px-3 py-2 text-xs">
                      <span className="mr-auto">Changed on disk</span>
                      <Button
                        onClick={() => {
                          draftsRef.current.set(activeFile, activeBuffer.diskText);
                          updateBuffer(activeFile, buffer => ({
                            ...buffer,
                            text: buffer.diskText,
                            savedText: buffer.diskText,
                            dirty: false,
                            conflict: false,
                            error: undefined,
                            revision: buffer.revision + 1
                          }));
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Reload from disk
                      </Button>
                      <Button
                        onClick={() => {
                          executeCommand({
                            type: "saveExternalAgentProjectSource",
                            args: {
                              projectId,
                              path: activeFile,
                              text: editorRef.current?.getValue() ?? activeText,
                              overwrite: true
                            }
                          });
                        }}
                        size="sm"
                        variant="destructive"
                      >
                        Overwrite
                      </Button>
                    </div>
                  )
                  : null}
                {activeBuffer.error
                  ? (
                    <div className="border-destructive/40 bg-destructive/5 text-destructive border-b px-3 py-2 text-xs">
                      {activeBuffer.error}
                    </div>
                  )
                  : null}
                {activeBuffer.loading
                  ? (
                    <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                      Loading source…
                    </div>
                  )
                  : (
                    <CodeEditor
                      className="min-h-0 flex-1 rounded-none border-0"
                      key={`${activeFile}:${activeBuffer.revision}`}
                      language={_sourceLanguage(activeFile)}
                      onChange={next => {
                        draftsRef.current.set(activeFile, next);
                        updateBuffer(activeFile, buffer => ({
                          ...buffer,
                          text: next,
                          dirty: next !== buffer.savedText
                        }));
                      }}
                      onDraftChange={next => {
                        draftsRef.current.set(activeFile, next);
                        updateBuffer(activeFile, buffer => {
                          const dirty = next !== buffer.savedText;
                          return dirty === buffer.dirty
                            ? buffer
                            : { ...buffer, dirty };
                        });
                      }}
                      onKeyDown={event => {
                        if (
                          event.key.toLowerCase() === "s"
                          && (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          executeCommand({
                            type: "saveExternalAgentProjectSource",
                            args: {
                              projectId,
                              path: activeFile,
                              text: editorRef.current?.getValue() ?? activeText
                            }
                          });
                        }
                      }}
                      ref={editorRef}
                      value={activeText}
                    />
                  )}
              </>
            )
            : (
              <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                Select an Agent source file to edit.
              </div>
            )}
        </main>
      </div>
      <ConfirmDialog
        confirmLabel="Discard changes"
        description="Your unsaved changes will be lost."
        onConfirm={() => {
          const path = pendingClose;
          setPendingClose(null);
          if (path) { closeSource(path); }
        }}
        onOpenChange={open => {
          if (!open) { setPendingClose(null); }
        }}
        open={pendingClose !== null}
        title={`Discard changes to ${pendingClose ?? "source"}?`}
      />
      <ConfirmDialog
        confirmLabel="Discard changes"
        description="One or more open source files have unsaved changes."
        onConfirm={() => {
          const resolve = closeResolver;
          discardAll();
          setCloseResolver(null);
          resolve?.(true);
        }}
        onOpenChange={open => {
          if (!open && closeResolver) {
            const resolve = closeResolver;
            setCloseResolver(null);
            resolve(false);
          }
        }}
        open={closeResolver !== null}
        title="Discard unsaved Agent source changes?"
      />
    </div>
  );
};

interface SourceBuffer {
  path: string;
  text: string;
  savedText: string;
  diskText: string;
  dirty: boolean;
  conflict: boolean;
  loading: boolean;
  revision: number;
  error?: string;
}

function _sourceLanguage(path: string): CodeEditorLanguage {
  if (path.endsWith(".ts")) { return "typescript"; }
  if (path.endsWith(".js")) { return "javascript"; }
  return "markdown";
}

function _sameRuntimeModel(
  left: Thread["model"],
  right: Thread["model"]
): boolean {
  return (
    left?.provider === right?.provider
    && left?.id === right?.id
    && left?.params?.reasoning === right?.params?.reasoning
  );
}

function _isLocalServerDraftReady(thread: Thread): boolean {
  const message = thread.context?.messages?.at(-1);
  return Boolean(
    message?.role === "user"
    && message.content.length === 1
    && message.content[0]?.type === "text"
    && message.content[0].text.trim()
  );
}

export const ExternalProjectTabPane = memo(_ExternalProjectTabPane);
