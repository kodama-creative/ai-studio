import { getThreadRuntimeProfile } from "@llm-space/core";
import { agentModelMatchesDefinition } from "@llm-space/runtime";
import {
  runtimeToolApprovalViews,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import {
  AlertTriangleIcon,
  BotIcon,
  CableIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  Code2Icon,
  ExternalLinkIcon,
  FileCode2Icon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PackageCheckIcon,
  RefreshCwIcon,
  XIcon
} from "lucide-react";
import {
  memo,
  type ReactNode,
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
  ThreadRuntimeProfileType,
  ThreadServerRunLineage
} from "@llm-space/core";

import {
  createRpcTransport,
  decideSessionBudget,
  decideToolApproval,
  externalAgentProjects
} from "@/client";
import {
  executeTool,
  type ToolExecutor
} from "@/client/tool-execution";
import { useCommands, useRegisterCommands } from "@/commands";
import {
  CodeEditor,
  type CodeEditorLanguage
} from "@/components/code-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useModels } from "@/components/model-provider";
import { ThreadPlayground } from "@/components/thread-playground";
import { ModelCallLimitSummary } from "@/components/thread-playground/model-call-limit-summary";
import { RuntimeProfileControl } from "@/components/thread-playground/runtime-profile-control";
import { SessionBudgetSummary } from "@/components/thread-playground/session-budget-summary";
import { getRuntimeExecutionMode } from "@/components/thread-playground/stores/run-mode";
import { Tooltip } from "@/components/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import {
  type ExternalAgentProjectArtifactSummary,
  type ExternalAgentProjectConnectionActivation,
  type ExternalAgentProjectRunBlockReason,
  type ExternalAgentProjectRuntimeStatus,
  type ExternalAgentProjectStatus,
  type ExternalAgentProjectSubagentRun,
  type ExternalAgentProjectThreadRecord,
  type ExternalAgentProjectView,
  getExternalAgentProjectRunBlockReason,
  hasPendingExternalAgentProjectToolResult
} from "@/shared/external-agent-project";
import {
  consumeExternalProjectSource,
  subscribeExternalProjectSource
} from "./external-project-source-navigation";
import { reconcileExternalProjectThreadModel } from "./external-project-thread-model";

import type {
  ExternalEditorId,
  ExternalEditorStatus
} from "@/shared/external-editor";

const _ExternalProjectTabPane = function ExternalProjectTabPane({
  projectId,
  threadId,
  active,
  refreshNonce
}: {
  readonly active: boolean;
  readonly projectId: string;
  readonly refreshNonce: number;
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
          <ProjectDebugPane
            projectId={projectId}
            refreshNonce={refreshNonce}
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
  const runtimePhaseListener = useRef<((
    phase: "compacting" | "idle"
  ) => void) | null>(null);
  const runtimeSessionListener = useRef<((
    session: StoredRuntimeSession
  ) => void) | null>(null);
  const activeSandboxAttachmentMessageIds = useRef<readonly string[]>([]);
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
          const profile = current ? getThreadRuntimeProfile(current) : null;
          const workingBase = current?.runtimeWorkingBase;
          let selectedWorkingBase:
            | { branchId: string; checkpointId: string; }
            | null = null;
          if (
            profile?.type === "localServer"
            && workingBase
            && workingBase.sessionId === profile.serverSessionId
          ) {
            selectedWorkingBase = {
              branchId: workingBase.branchId,
              checkpointId: workingBase.checkpointId
            };
          }
          return current && profile?.type === "localServer"
            ? {
              type: "localServerAgentProject" as const,
              projectId,
              threadId,
              ...(selectedWorkingBase
                ? { workingBase: selectedWorkingBase }
                : {})
            }
            : {
              type: "agentProject" as const,
              projectId,
              threadId,
              sandboxAttachmentMessageIds:
                activeSandboxAttachmentMessageIds.current,
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
          runtimeSessionListener.current?.(session);
        },
        onRuntimePhase: phase => {
          runtimePhaseListener.current?.(phase);
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
  const subscribeRuntimePhase = useCallback(
    (listener: (phase: "compacting" | "idle") => void) => {
      runtimePhaseListener.current = listener;
      return () => {
        if (runtimePhaseListener.current === listener) {
          runtimePhaseListener.current = null;
        }
      };
    },
    []
  );
  const subscribeCommittedRuntimeSession = useCallback(
    (listener: (session: StoredRuntimeSession) => void) => {
      runtimeSessionListener.current = listener;
      return () => {
        if (runtimeSessionListener.current === listener) {
          runtimeSessionListener.current = null;
        }
      };
    },
    []
  );
  const renameRuntimeBranch = useCallback(
    async (branchId: string, label: string) => {
      const committed = await externalAgentProjects.renameRuntimeBranch(
        projectId,
        threadId,
        branchId,
        label
      );
      activeRuntimeSession.current = committed;
      return committed;
    },
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
            message: "The latest Agent requires Sandbox. Switch this Thread to Desktop Sandbox."
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
      const nextThread = reconcileExternalProjectThreadModel({
        current: current.thread,
        next: thread,
        projectId,
        snapshot: project?.snapshot ?? "",
        definitionFingerprint: project?.definitionFingerprint ?? "",
        modelMatchesDefinition: agentModelMatchesDefinition({
          model: thread.model,
          reasoning: thread.model?.params?.reasoning,
          definition: current.syncedDefinition
        })
      });
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
    (type: ThreadRuntimeProfileType) => {
      const current = recordRef.current;
      if (!current) {
        return;
      }
      const currentProfile = getThreadRuntimeProfile(current.thread);
      if (
        currentProfile.type === type
        && (
          currentProfile.type !== "localServer"
          || currentProfile.artifactFingerprint === project?.artifactFingerprint
        )
      ) {
        return;
      }
      void (async () => {
        try {
          await flush();
          setRuntimeStatus({ state: "preparing" });
          const next = await externalAgentProjects.setRuntimeProfile(
            projectId,
            threadId,
            type
          );
          setRecord(next);
          await load();
        } catch (error) {
          toast.error("Unable to change Runtime Profile", {
            description: error instanceof Error ? error.message : String(error)
          });
          await load();
        }
      })();
    },
    [flush, load, project?.artifactFingerprint, projectId, threadId]
  );
  const requestRuntimeProfileSelection = useCallback(
    (runtimeProfileType: ThreadRuntimeProfileType) => {
      executeCommand({
        type: "setExternalAgentProjectRuntimeProfile",
        args: { projectId, runtimeProfileType, threadId }
      });
    },
    [executeCommand, projectId, threadId]
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
      },
      setExternalAgentProjectRuntimeProfile: ({
        projectId: commandProjectId,
        runtimeProfileType,
        threadId: commandThreadId
      }) => {
        if (
          commandProjectId === projectId
          && commandThreadId === threadId
          && !running
        ) {
          selectRuntimeProfile(runtimeProfileType);
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
      activeSandboxAttachmentMessageIds.current = profile.type === "desktopSandbox"
        ? (thread.context?.messages ?? [])
          .map(message => message.id)
          .filter(messageId => Boolean(
            thread.sandboxAttachments?.[messageId]?.length
          ))
        : [];
      if (profile.type === "localServer") {
        const serverRun = activeServerRun.current;
        return {
          ...thread,
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
      const runtime = activeRuntimeSession.current;
      const runtimeRun = runtime?.snapshot.runs.find(
        run => run.id === serverRun.lineage.runId
      );
      const checkpoint = runtime?.snapshot.history.checkpoints
        .filter(item => item.runId === runtimeRun?.id)
        .at(-1);
      return {
        runId: serverRun.lineage.runId,
        ...(checkpoint
          ? {
            branchId: checkpoint.branchId,
            checkpointId: checkpoint.id
          }
          : {}),
        state,
        checkpointOrder: 1,
        profile: "localServer" as const,
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
  const baseRunBlockReason: ExternalAgentProjectRunBlockReason | null =
    project && record
      ? (localServer ? null : getExternalAgentProjectRunBlockReason(project, record))
      : "sourceUnavailable";
  const parentRuntimeSession = record?.thread.runtimeSession as
    | StoredRuntimeSession
    | undefined;
  const resumableSubagent = parentRuntimeSession?.snapshot.activeRunId
    ? [...(record?.subagentRuns ?? [])].findLast(run =>
      run.parent.sessionId === parentRuntimeSession.snapshot.id
      && run.parent.runId === parentRuntimeSession.snapshot.activeRunId)
    : undefined;
  const runBlockReason = baseRunBlockReason === "pendingToolResult"
    && resumableSubagent
    && _subagentReadyToResume(resumableSubagent)
    ? null
    : baseRunBlockReason;
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
        decideSessionBudget={decideSessionBudget}
        decideToolApproval={decideToolApproval}
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
              onSelect={requestRuntimeProfileSelection}
              profile={runtimeProfile}
              sandboxRequired={project.sandboxRequired}
              sandboxStatus={sandboxStatus}
              status={runtimeStatus}
            />
            <SessionBudgetSummary limits={record.syncedDefinition.limits} />
            <ModelCallLimitSummary limits={record.syncedDefinition.limits} />
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
                    requestRuntimeProfileSelection(
                      localServer ? "localServer" : "desktopSandbox"
                    );
                  }}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCwIcon className="size-3" />
                  <span className="hidden min-[1100px]:inline">
                    {localServer ? "Use latest artifact" : "Switch to Sandbox"}
                  </span>
                  <span className="min-[1100px]:hidden">
                    {localServer ? "Use latest" : "Use Sandbox"}
                  </span>
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
        renameRuntimeBranch={localServer ? renameRuntimeBranch : undefined}
        renderPromptVariables={!localServer}
        resolveCommittedRuntimeSession={
          () => activeRuntimeSession.current ?? undefined
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
        sessionLimits={record.syncedDefinition.limits}
        stageSandboxFiles={desktopSandbox ? stageSandboxFiles : undefined}
        subagentRuns={record.subagentRuns}
        subscribeCommittedRuntimeSession={subscribeCommittedRuntimeSession}
        subscribeRuntimePhase={subscribeRuntimePhase}
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

const ProjectDebugPane = function ProjectDebugPane({
  projectId,
  refreshNonce
}: {
  readonly projectId: string;
  readonly refreshNonce: number;
}) {
  const [project, setProject] = useState<ExternalAgentProjectView | null>(null);
  const [editorStatus, setEditorStatus] = useState<ExternalEditorStatus | null>(
    null
  );
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Map<string, SourceBuffer>>(new Map());
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
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
        updateBuffer(path, buffer => ({
          ...buffer,
          text,
          loading: false,
          error: undefined
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
    const [next, nextEditorStatus] = await Promise.all([
      externalAgentProjects.inspect(projectId),
      editorStatus
        ? Promise.resolve(editorStatus)
        : externalAgentProjects.editorStatus()
    ]);
    setProject(next);
    setEditorStatus(nextEditorStatus);
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const paths = openFilesRef.current.filter(path =>
      next.sourceFiles.includes(path));
    const removed = openFilesRef.current.filter(path =>
      !next.sourceFiles.includes(path));
    if (removed.length > 0) {
      setOpenFiles(paths);
      setActiveFile(current => (current && paths.includes(current)
        ? current
        : null));
      setBuffers(current => {
        const nextBuffers = new Map(current);
        for (const path of removed) { nextBuffers.delete(path); }
        return nextBuffers;
      });
    }
    await Promise.all(
      paths.map(async path => {
        const { text } = await externalAgentProjects.readSource(
          projectId,
          path
        );
        const buffer = buffersRef.current.get(path);
        if (buffer && text !== buffer.text) {
          updateBuffer(path, current => ({
            ...current,
            text,
            error: undefined,
            revision: current.revision + 1
          }));
        }
      })
    );
  }, [editorStatus, projectId, updateBuffer]);

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
    setBuffers(currentBuffers => {
      const nextBuffers = new Map(currentBuffers);
      nextBuffers.delete(path);
      return nextBuffers;
    });
  }, []);

  const activeBuffer = activeFile ? buffers.get(activeFile) : undefined;
  const activeText = activeBuffer?.text ?? "";
  const preferredEditor = editorStatus?.editors.find(
    editor => editor.id === editorStatus.preferredEditorId
  ) ?? null;
  const openInEditor = useCallback(
    (editorId?: ExternalEditorId, sourcePath?: string) => {
      if (editorId) {
        setEditorStatus(current => {
          return current ? { ...current, preferredEditorId: editorId } : current;
        });
      }
      executeCommand({
        type: "openExternalAgentProjectInEditor",
        args: {
          projectId,
          ...(editorId ? { editorId } : {}),
          ...(sourcePath ? { sourcePath } : {})
        }
      });
    },
    [executeCommand, projectId]
  );
  const handleOpenSource = useCallback(
    (path: string) => { void openSource(path); },
    [openSource]
  );

  if (!project) { return null; }
  return (
    <div
      className="flex size-full min-h-0 flex-col"
      data-agent-build={projectId}
      data-agent-project-debug={projectId}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <BotIcon className="text-primary size-4" />
        <span className="text-sm font-medium">{project.name}</span>
        <ProjectStatus status={project.status} />
        <Button
          className="ml-auto"
          onClick={() => { openInEditor(); }}
          size="sm"
          variant="outline"
        >
          <Code2Icon />
          {preferredEditor ? `Open in ${preferredEditor.label}` : "Open in editor"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Choose external editor"
              size="icon-sm"
              variant="outline"
            >
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {editorStatus?.editors.map(editor => (
              <DropdownMenuItem
                disabled={!editor.available}
                key={editor.id}
                onSelect={() => { openInEditor(editor.id); }}
              >
                <Code2Icon /> Open in {editor.label}
                {!editor.available ? " — Not installed" : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                executeCommand({
                  type: "revealExternalAgentProject",
                  args: { path: project.path }
                });
              }}
            >
              <FolderOpenIcon /> Reveal in Finder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {project.error && project.diagnostics.length === 0
        ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive border-b px-3 py-2 text-xs whitespace-pre-wrap">
            {project.error}
          </div>
        )
        : null}
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r p-2">
          <button
            className={cn(
              "focus-visible:ring-ring/30 mb-2 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs outline-none focus-visible:ring-2",
              activeFile === null
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
            onClick={() => { setActiveFile(null); }}
            type="button"
          >
            <PackageCheckIcon className="size-3.5" />
            Artifact summary
          </button>
          {project.diagnostics.length > 0
            ? (
              <section aria-label="Build diagnostics" className="mb-3">
                <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wide uppercase">
                  Diagnostics · {project.diagnostics.length}
                </p>
                <div className="grid gap-1">
                  {project.diagnostics.map((diagnostic, index) => (
                    <div
                      className="border-border/60 bg-muted/30 grid grid-cols-[minmax(0,1fr)_auto] items-start rounded border"
                      key={`${diagnostic.code}:${diagnostic.sourcePath ?? "project"}:${index}`}
                    >
                      <button
                        className="min-w-0 px-2 py-1.5 text-left"
                        disabled={!diagnostic.sourcePath}
                        onClick={() => {
                          if (diagnostic.sourcePath) {
                            if (project.sourceFiles.includes(
                              diagnostic.sourcePath
                            )) {
                              void openSource(diagnostic.sourcePath);
                            } else {
                              openInEditor(undefined, diagnostic.sourcePath);
                            }
                          }
                        }}
                        title={diagnostic.message}
                        type="button"
                      >
                        <span
                          className={cn(
                            "flex items-center gap-1 text-[10px] font-medium uppercase",
                            diagnostic.severity === "error"
                              ? "text-destructive"
                              : "text-warning"
                          )}
                        >
                          <CircleAlertIcon className="size-3" />
                          {diagnostic.severity}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs">
                          {diagnostic.message}
                        </span>
                        <span className="text-muted-foreground mt-1 block truncate font-mono text-[10px]">
                          {diagnostic.sourcePath ?? "Project"}
                        </span>
                      </button>
                      {diagnostic.sourcePath
                        ? (
                          <Tooltip content="Open diagnostic source in editor">
                            <Button
                              aria-label={`Open ${diagnostic.sourcePath} in external editor`}
                              className="m-1 size-6"
                              disabled={!preferredEditor?.available}
                              onClick={() => {
                                openInEditor(
                                  undefined,
                                  diagnostic.sourcePath ?? undefined
                                );
                              }}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <ExternalLinkIcon className="size-3" />
                            </Button>
                          </Tooltip>
                        )
                        : null}
                    </div>
                  ))}
                </div>
              </section>
            )
            : null}
          <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wide uppercase">
            Source · read only
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
                      </button>
                      <Tooltip content={`Open ${file} in external editor`}>
                        <Button
                          aria-label={`Open ${file} in external editor`}
                          className="size-5 opacity-70 group-hover:opacity-100"
                          disabled={!preferredEditor?.available}
                          onClick={() => { openInEditor(undefined, file); }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <ExternalLinkIcon className="size-3" />
                        </Button>
                      </Tooltip>
                      <Button
                        aria-label={`Close ${file}`}
                        className="mr-1 size-5 opacity-70 group-hover:opacity-100"
                        onClick={() => { closeSource(file); }}
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
                      readonly
                      value={activeText}
                    />
                  )}
              </>
            )
            : (
              <ArtifactSummary
                onOpenSource={handleOpenSource}
                status={project.status}
                summary={project.artifactSummary}
              />
            )}
        </main>
      </div>
    </div>
  );
};

interface SourceBuffer {
  path: string;
  text: string;
  loading: boolean;
  revision: number;
  error?: string;
}

function ProjectStatus({ status }: { readonly status: ExternalAgentProjectStatus; }) {
  const content = status === "ready"
    ? { icon: CheckCircle2Icon, label: "Ready", className: "text-success" }
    : status === "building"
      ? { icon: LoaderCircleIcon, label: "Building", className: "text-primary" }
      : status === "missing"
        ? { icon: CircleAlertIcon, label: "Missing", className: "text-destructive" }
        : { icon: CircleAlertIcon, label: "Invalid", className: "text-destructive" };
  const Icon = content.icon;
  return (
    <span className={cn("flex items-center gap-1 text-xs", content.className)}>
      <Icon className={cn("size-3.5", status === "building" && "animate-spin")} />
      {content.label}
    </span>
  );
}

const ArtifactSummary = memo(({
  onOpenSource,
  status,
  summary
}: {
  readonly onOpenSource: (path: string) => void;
  readonly status: ExternalAgentProjectStatus;
  readonly summary: ExternalAgentProjectArtifactSummary | null;
}) => {
  if (!summary) {
    const message = status === "building"
      ? "Building the latest source…"
      : status === "missing"
        ? "The Agent Project source is unavailable."
        : "Fix the compiler diagnostics in your external editor to produce a valid artifact.";
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm">
        {status === "building"
          ? <LoaderCircleIcon className="text-primary size-5 animate-spin" />
          : <CircleAlertIcon className="size-5" />}
        <p>{message}</p>
      </div>
    );
  }
  const limits = Object.entries(summary.limits ?? {});
  const sandbox = summary.sandbox;
  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-5">
      <div className="mx-auto grid min-w-0 max-w-4xl gap-5">
        <header className="min-w-0">
          <div className="flex items-center gap-2">
            <PackageCheckIcon className="text-primary size-4" />
            <h2 className="text-sm font-medium">Compiled artifact</h2>
          </div>
          <p
            className="text-muted-foreground mt-1 block min-w-0 max-w-full truncate font-mono text-[10px]"
            title={summary.fingerprint}
          >
            {summary.fingerprint}
          </p>
        </header>
        <div className="grid gap-3 xl:grid-cols-2">
          <SummaryCard label="Model">
            <p className="font-mono text-xs">{summary.model.id}</p>
            <p className="text-muted-foreground text-xs">
              {summary.model.dynamic ? "Dynamic selection" : "Static selection"}
              {summary.model.reasoning ? ` · ${summary.model.reasoning}` : ""}
            </p>
          </SummaryCard>
          <SummaryCard label="Run limits">
            {limits.length > 0
              ? limits.map(([name, value]) => (
                <p className="flex justify-between gap-3 text-xs" key={name}>
                  <span className="text-muted-foreground truncate">{name}</span>
                  <span>{value === false ? "Unlimited" : value}</span>
                </p>
              ))
              : <p className="text-muted-foreground text-xs">Runtime defaults</p>}
          </SummaryCard>
          <SummaryCard label="Environment">
            {summary.environment.length > 0
              ? summary.environment.map(requirement => (
                <p className="flex justify-between gap-3 text-xs" key={requirement.name}>
                  <span className="truncate font-mono">{requirement.name}</span>
                  <span className="text-muted-foreground">
                    {requirement.kind} · {requirement.required ? "required" : "optional"}
                  </span>
                </p>
              ))
              : <p className="text-muted-foreground text-xs">No requirements</p>}
          </SummaryCard>
          <SummaryCard label="Sandbox">
            {sandbox
              ? (
                <button
                  className="hover:text-primary flex w-full items-center justify-between gap-3 text-left text-xs"
                  onClick={() => { onOpenSource(sandbox.sourcePath); }}
                  type="button"
                >
                  <span className="truncate font-mono">{sandbox.sourcePath}</span>
                  <span className="text-muted-foreground">
                    {sandbox.workspaceFileCount} workspace files
                  </span>
                </button>
              )
              : <p className="text-muted-foreground text-xs">Direct allowed</p>}
          </SummaryCard>
        </div>
        <section>
          <h3 className="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
            Capabilities · {summary.capabilities.length}
          </h3>
          {summary.capabilities.length > 0
            ? (
              <div className="grid gap-2 xl:grid-cols-2">
                {summary.capabilities.map(capability => (
                  <button
                    className="border-border hover:bg-muted/60 flex min-w-0 items-center gap-2 rounded border px-3 py-2 text-left"
                    key={`${capability.kind}:${capability.sourcePath}:${capability.name}`}
                    onClick={() => { onOpenSource(capability.sourcePath); }}
                    type="button"
                  >
                    <FileCode2Icon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{capability.name}</span>
                      <span className="text-muted-foreground block truncate font-mono text-[10px]">
                        {capability.sourcePath}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {capability.detail ?? capability.kind}
                    </span>
                  </button>
                ))}
              </div>
            )
            : <p className="text-muted-foreground text-xs">No optional capabilities.</p>}
        </section>
      </div>
    </div>
  );
});

function SummaryCard({
  children,
  label
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <section className="border-border rounded border p-3">
      <h3 className="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
        {label}
      </h3>
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

function _sourceLanguage(path: string): CodeEditorLanguage {
  if (path.endsWith(".ts")) { return "typescript"; }
  if (path.endsWith(".js")) { return "javascript"; }
  return "markdown";
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

function _subagentReadyToResume(
  run: ExternalAgentProjectSubagentRun
): boolean {
  if (run.terminal) { return true; }
  if (run.status === "waitingForApproval") {
    return !runtimeToolApprovalViews(run.runtimeSession)
      .some(approval => approval.state === "pending");
  }
  if (run.status === "waitingForBudget") {
    return !run.runtimeSession.snapshot.budget?.waits
      .some(wait => wait.status === "waiting");
  }
  return run.status === "waitingForContinue";
}

export const ExternalProjectTabPane = memo(_ExternalProjectTabPane);
