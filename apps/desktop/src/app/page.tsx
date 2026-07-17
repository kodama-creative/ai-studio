import { BotIcon, GitBranchIcon, MessagesSquareIcon } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";

import { externalAgentProjects } from "@/client";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useExperimental } from "@/components/experimental-provider";
import { ExternalAgentProjectTrustDialog } from "@/components/external-agent-project-trust-dialog";
import { ExternalAgentProjectsPanel } from "@/components/external-agent-projects-panel";
import { FileSystemTreeView } from "@/components/file-system-tree-view";
import { FirecrawlLimitDialog } from "@/components/firecrawl-limit-dialog";
import { useModels } from "@/components/model-provider";
import { ThreadTabs, useThreadTabs } from "@/components/thread-tabs";
import { requestExternalProjectSource } from "@/components/thread-tabs/external-project-source-navigation";
import { canCloseTabs } from "@/components/thread-tabs/tab-close-guards";
import { TracePanel } from "@/components/trace-panel";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
import { UpdateIndicator } from "@/components/update-indicator";
import { UpdateStatusProvider } from "@/components/update-status-provider";
import { Welcome } from "@/components/welcome";
import { track } from "@/lib/analytics";
import { electrobun } from "@/lib/electrobun";
import {
  importThreadFileRecords,
  importThreadFiles,
  type ThreadImportFile
} from "@/lib/import-threads";
import { useFullScreen } from "@/lib/use-full-screen";

import type { SettingsTab } from "@/shared/commands";
import type {
  ExternalAgentProjectPreview,
  ExternalAgentProjectSummary,
  ExternalAgentProjectView
} from "@/shared/external-agent-project";
import type { TraceRecord } from "@/shared/traces";

// Overlay surfaces that aren't part of the first paint — settings, the command
// palette, onboarding, and examples. Loaded lazily so their code (and heavy
// deps like the color picker and cmdk) stays out of the initial chunk until
// first opened.
const SettingsDialog = lazy(async () =>
  import("@/components/settings/settings-dialog").then(m => ({
    default: m.SettingsDialog
  })));
const CommandPalette = lazy(async () =>
  import("@/components/command-palette").then(m => ({
    default: m.CommandPalette
  })));
const OnboardDialog = lazy(async () =>
  import("@/components/onboard-dialog").then(m => ({
    default: m.OnboardDialog
  })));
const StartFromExampleDialog = lazy(async () =>
  import("@/components/start-from-example-dialog").then(m => ({
    default: m.StartFromExampleDialog
  })));
const NewAgentProjectDialog = lazy(async () =>
  import("@/components/new-agent-project-dialog").then(m => ({
    default: m.NewAgentProjectDialog
  })));

/**
 * Renders a lazily-loaded overlay only once `open` first becomes true, then
 * keeps it mounted. Deferring the initial mount keeps the overlay's chunk out of
 * first paint; latching it mounted afterwards means its close animation and
 * subsequent opens are instant. The latch is a render-time ref (not an effect)
 * so the lazy `import()` starts in the same render that opens the overlay,
 * without a wasted extra render of the page tree.
 */
function LazyOverlay({
  open,
  children
}: {
  readonly children: ReactNode;
  readonly open: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) {
    setMounted(true);
  }
  if (!mounted) { return null; }
  return <Suspense fallback={null}>{children}</Suspense>;
}

type SidebarMode = "agents" | "threads" | "traces";

const SIDEBAR_MODE_STORAGE_KEY = "llm-space:sidebar-mode";

function _loadSidebarMode(): SidebarMode {
  const stored = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
  return stored === "agents" || stored === "traces" ? stored : "threads";
}

const _SidebarModeSwitch = function SidebarModeSwitch({
  mode,
  onModeChange,
  tracingEnabled
}: {
  readonly mode: SidebarMode;
  readonly onModeChange: (mode: SidebarMode) => void;
  readonly tracingEnabled: boolean;
}) {
  return (
    <div
      className={`bg-muted/60 grid w-full ${tracingEnabled ? "grid-cols-3" : "grid-cols-2"} rounded-md p-0.5`}
    >
      <Button
        aria-pressed={mode === "threads"}
        className="h-6 justify-center px-2"
        onClick={() => { onModeChange("threads"); }}
        size="sm"
        variant={mode === "threads" ? "secondary" : "ghost"}
      >
        <MessagesSquareIcon className="size-3" />
        Threads
      </Button>
      <Button
        aria-pressed={mode === "agents"}
        className="h-6 justify-center px-2"
        onClick={() => { onModeChange("agents"); }}
        size="sm"
        variant={mode === "agents" ? "secondary" : "ghost"}
      >
        <BotIcon className="size-3" />
        Agents
      </Button>
      {tracingEnabled
        ? (
          <Button
            aria-pressed={mode === "traces"}
            className="relative h-6 justify-center px-2"
            onClick={() => { onModeChange("traces"); }}
            size="sm"
            variant={mode === "traces" ? "secondary" : "ghost"}
          >
            <GitBranchIcon className="size-3" />
            Traces
            <span className="border-primary/30 bg-primary/10 text-primary absolute top-1 right-2 rounded px-1 py-px text-[0.5rem] leading-none font-semibold tracking-wide uppercase">
              Beta
            </span>
          </Button>
        )
        : null}
    </div>
  );
};

export function Page() {
  return (
    <CommandProvider>
      <UpdateStatusProvider>
        <PageInner />
      </UpdateStatusProvider>
    </CommandProvider>
  );
}

// Commands that need context the palette can't supply (a file path / URL) or
// that make no sense to invoke from the palette itself.
const COMMAND_PALETTE_BLACKLIST = [
  "renameFile",
  "duplicateFile",
  "deleteFile",
  "revealFile",
  "copyFile",
  "openLink",
  "openCommandPalette",
  "openVariables",
  "newFileFromPromptExample",
  "closeTab",
  "closeOtherTabs",
  "createTraceProject",
  "createConnectedTraceProject",
  "importLangfuseTraceFiles",
  "syncLangfuseTraceIds",
  "trustExternalAgentProject",
  "createExternalAgentProjectThread",
  "refreshExternalAgentProject",
  "revealExternalAgentProject",
  "removeExternalAgentProject",
  "renameExternalAgentProjectThread",
  "duplicateExternalAgentProjectThread",
  "deleteExternalAgentProjectThread",
  "syncExternalAgentProjectThreadFromAgent",
  "enableExternalAgentProjectTools",
  "saveExternalAgentProjectSource",
  // Only meaningful from the "ready to install" toast; a bare palette
  // invocation would silently no-op (or restart mid-work).
  "applyUpdateAndRestart"
];

/** Whether a drag carries OS files (vs. the tree's internal node-reorder drag). */
function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

function PageInner() {
  const tabs = useThreadTabs();
  const { executeCommand } = useCommands();
  const models = useModels();
  const { tracingEnabled } = useExperimental();

  const {
    close,
    closeOthers,
    closeAll,
    openTrace,
    reopenClosed,
    activateNext,
    activatePrevious
  } = tabs;

  // Collapse / expand the left side panel.
  const sidebarPanelRef = usePanelRef();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) { return; }
    if (panel.isCollapsed()) { panel.expand(); } else { panel.collapse(); }
  }, [sidebarPanelRef]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  // One event per open transition, no matter which command opened Settings.
  useEffect(() => {
    if (settingsOpen) { track({ event: "settings_opened", properties: {} }); }
  }, [settingsOpen]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(() => models.length === 0);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [newAgentProjectOpen, setNewAgentProjectOpen] = useState(false);
  const [externalProjectsRefresh, setExternalProjectsRefresh] = useState(0);
  const [pendingTrust, setPendingTrust] =
    useState<ExternalAgentProjectPreview | null>(null);
  const [discardAgentSourcesRequest, setDiscardAgentSourcesRequest] = useState<{
    reason: "quit" | "reload";
    requestId: string;
  } | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(_loadSidebarMode);
  useEffect(() => {
    const next =
      !tracingEnabled && sidebarMode === "traces" ? "threads" : sidebarMode;
    if (next !== sidebarMode) {
      // Disabling tracing invalidates the selected mode and must persist Threads.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarMode(next);
    }
    window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, next);
  }, [sidebarMode, tracingEnabled]);
  // Which folder a chosen example's thread is created into (default: root).
  const examplesParentRef = useRef("");

  const openExternalProjectView = useCallback(
    async (summary: ExternalAgentProjectSummary) => {
      try {
        const project = await externalAgentProjects.trustAndOpen(summary.path);
        setExternalProjectsRefresh(value => value + 1);
        tabs.openExternalProject({
          projectId: project.id,
          path: project.path,
          projectName: project.name
        });
      } catch (error) {
        toast.error("Unable to open Agent", {
          description: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [tabs]
  );
  const handleOpenExternalProject = useCallback(
    (project: ExternalAgentProjectSummary) => {
      void openExternalProjectView(project);
    },
    [openExternalProjectView]
  );
  const openExternalProjectThread = useCallback(
    (
      project: ExternalAgentProjectSummary,
      thread: { id: string; title: string; }
    ) => {
      tabs.openExternalProject({
        projectId: project.id,
        path: project.path,
        projectName: project.name,
        threadId: thread.id,
        threadTitle: thread.title
      });
    },
    [tabs]
  );
  const finishOpenExternalProject = useCallback(
    async (path: string) => {
      const project = await externalAgentProjects.trustAndOpen(path);
      setExternalProjectsRefresh(value => value + 1);
      const first = project.threads[0];
      if (first) { openExternalProjectThread(project, first); } else {
        tabs.openExternalProject({
          projectId: project.id,
          path: project.path,
          projectName: project.name
        });
      }
    },
    [openExternalProjectThread, tabs]
  );
  const browseExternalProject = useCallback(async () => {
    try {
      const preview = await externalAgentProjects.browse();
      if (!preview) { return; }
      if (preview.trusted) {
        executeCommand({
          type: "trustExternalAgentProject",
          args: { path: preview.path }
        });
      } else { setPendingTrust(preview); }
    } catch (error) {
      toast.error("Unable to open Agent Project", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  }, [executeCommand]);
  const handleAgentProjectCreated = useCallback(
    (project: ExternalAgentProjectView) => {
      setExternalProjectsRefresh(value => value + 1);
      setSidebarMode("agents");
      tabs.openExternalProject({
        projectId: project.id,
        path: project.path,
        projectName: project.name
      });
    },
    [tabs]
  );

  // File import: a hidden picker (opened by the `importFiles` command), the
  // parent directory it should import into, and page-wide drag-and-drop state.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingParentRef = useRef("");
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const { open: openTab } = tabs;
  const handleImportFiles = useCallback(
    async (files: File[] | FileList | ThreadImportFile[], parent: string) => {
      const list = [...files];
      if (list.length === 0) { return; }
      const { created, total } =
        list[0] instanceof File
          ? await importThreadFiles(parent, list as File[], models)
          : await importThreadFileRecords(
            parent,
            list as ThreadImportFile[],
            models
          );
      if (created.length === 0) {
        toast.error("No threads could be imported from the selected files.");
        return;
      }
      executeCommand({ type: "refreshTree", args: {} });
      for (const path of created) { openTab(path); }
      const skipped = total - created.length;
      toast.success(
        `Imported ${created.length} thread${created.length === 1 ? "" : "s"}`,
        skipped > 0 ? { description: `${skipped} file(s) skipped` } : undefined
      );
    },
    [models, executeCommand, openTab]
  );

  // Register the command handlers backed by page-level state (tabs, sidebar,
  // settings). `newFile` / `newFolder` / the tree ops are registered by the
  // file tree, which owns that state.
  useRegisterCommands({
    openExternalAgentProjectSource: ({
      projectId,
      projectPath,
      projectName,
      sourcePath
    }) => {
      tabs.openExternalProject({ projectId, path: projectPath, projectName });
      requestExternalProjectSource(projectId, sourcePath);
    },
    closeTab: async ({ id, path }) => {
      const target = id ?? (path ? `thread:${path}` : tabs.activeId);
      if (target && (await canCloseTabs([target]))) { close(target); }
    },
    closeOtherTabs: async ({ id, path }) => {
      const target = id ?? (path ? `thread:${path}` : tabs.activeId);
      const closing = tabs.tabs
        .filter(tab => tab.id !== target)
        .map(tab => tab.id);
      if (target && (await canCloseTabs(closing))) { closeOthers(target); }
    },
    closeAllTabs: async () => {
      if (await canCloseTabs(tabs.tabs.map(tab => tab.id))) { closeAll(); }
    },
    reopenClosedTab: () => { void reopenClosed(); },
    selectNextTab: () => { activateNext(); },
    selectPreviousTab: () => { activatePrevious(); },
    toggleSidebar: () => { toggleSidebar(); },
    openSettings: ({ tab }) => {
      if (tab) { setSettingsTab(tab); }
      setSettingsOpen(true);
    },
    openModelSettings: () => {
      setSettingsTab("models");
      setSettingsOpen(true);
    },
    openCommandPalette: () => { setCommandPaletteOpen(true); },
    openOnboard: () => { setOnboardOpen(true); },
    openStartFromExample: ({ parent = "" }) => {
      examplesParentRef.current = parent;
      setExamplesOpen(true);
    },
    createAgentProject: () => { setNewAgentProjectOpen(true); },
    openExternalAgentProject: () => void browseExternalProject(),
    trustExternalAgentProject: ({ path }) =>
      void finishOpenExternalProject(path).catch(error =>
        toast.error("Unable to open Agent Project", {
          description: error instanceof Error ? error.message : String(error)
        })),
    importFiles: ({ parent = "", files }) => {
      if (files) {
        void handleImportFiles(files, parent);
        return;
      }
      pendingParentRef.current = parent;
      fileInputRef.current?.click();
    }
  });

  // Bridge commands dispatched from the bun process (native menu / shortcuts)
  // into the renderer dispatcher.
  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) { return; }
    rpc.addMessageListener("executeCommand", executeCommand);
    const requestDiscard = (request: {
      reason: "quit" | "reload";
      requestId: string;
    }) => { setDiscardAgentSourcesRequest(request); };
    rpc.addMessageListener("requestDiscardDirtyAgentSources", requestDiscard);
    return () => {
      rpc.removeMessageListener("executeCommand", executeCommand);
      rpc.removeMessageListener(
        "requestDiscardDirtyAgentSources",
        requestDiscard
      );
    };
  }, [executeCommand]);

  const fullScreen = useFullScreen();
  const handleOpenTrace = useCallback(
    (trace: TraceRecord) => {
      openTrace({
        projectId: trace.projectId,
        traceKey: trace.key,
        title: trace.title
      });
    },
    [openTrace]
  );
  const handleCloseTab = useCallback(
    (id: string) => { executeCommand({ type: "closeTab", args: { id } }); },
    [executeCommand]
  );
  const handleRefreshTab = useCallback(
    async (id: string) => {
      if (await canCloseTabs([id])) { tabs.refresh(id); }
    },
    [tabs]
  );
  const handleCloseOtherTabs = useCallback(
    (id: string) => { executeCommand({ type: "closeOtherTabs", args: { id } }); },
    [executeCommand]
  );
  const handleCloseAllTabs = useCallback(
    () => { executeCommand({ type: "closeAllTabs", args: {} }); },
    [executeCommand]
  );
  const handleRevealFile = useCallback(
    (path: string) => { executeCommand({ type: "revealFile", args: { path } }); },
    [executeCommand]
  );
  const handleMoveToTrash = useCallback(
    (path: string) => { executeCommand({ type: "deleteFile", args: { path } }); },
    [executeCommand]
  );
  const handleNewFile = useCallback(
    () => { executeCommand({ type: "newFile", args: {} }); },
    [executeCommand]
  );
  const handleToggleSidebar = useCallback(
    () => { executeCommand({ type: "toggleSidebar", args: {} }); },
    [executeCommand]
  );
  const effectiveSidebarMode =
    tracingEnabled || sidebarMode !== "traces" ? sidebarMode : "threads";

  return (
    <div
      className="relative flex size-full flex-col"
      onDragEnter={e => {
        if (!hasFiles(e)) { return; }
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragLeave={e => {
        if (!hasFiles(e)) { return; }
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
        }
      }}
      onDragOver={e => {
        if (!hasFiles(e)) { return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={e => {
        if (!hasFiles(e)) { return; }
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        void handleImportFiles(e.dataTransfer.files, "");
      }}
    >
      <input
        accept=".json,application/json"
        aria-label="Import thread files"
        className="hidden"
        multiple
        onChange={e => {
          const files = e.target.files;
          if (files?.length) {
            void handleImportFiles(files, pendingParentRef.current);
          }
          e.target.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
      <main className="min-h-0 grow">
        <ResizablePanelGroup>
          <ResizablePanel
            className="bg-sidebar flex flex-col"
            collapsedSize={0}
            collapsible
            defaultSize="16.7%"
            minSize={200}
            onResize={size => { setSidebarOpen(size.inPixels > 0); }}
            panelRef={sidebarPanelRef}
          >
            <FileSystemTreeView
              className={
                effectiveSidebarMode === "threads" ? "min-h-0 flex-1" : "hidden"
              }
              onMove={tabs.handleMove}
              onRemove={tabs.handleRemove}
              onSelectFile={tabs.open}
            />
            {effectiveSidebarMode === "agents"
              ? (
                <ExternalAgentProjectsPanel
                  className="min-h-0 flex-1"
                  onOpenProject={handleOpenExternalProject}
                  onOpenThread={openExternalProjectThread}
                  refreshNonce={externalProjectsRefresh}
                />
              )
              : null}
            {tracingEnabled
              ? (
                <TracePanel
                  className={
                    effectiveSidebarMode === "traces"
                      ? "min-h-0 flex-1"
                      : "hidden"
                  }
                  onOpenTrace={handleOpenTrace}
                />
              )
              : null}
            <div className="border-border/70 electrobun-webkit-app-region-no-drag flex shrink-0 border-t px-3 py-2">
              <_SidebarModeSwitch
                mode={effectiveSidebarMode}
                onModeChange={setSidebarMode}
                tracingEnabled={tracingEnabled}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize={640}>
            {tabs.tabs.length === 0
              ? (
                <Welcome
                  onModels={() => {
                    executeCommand({
                      type: "openSettings",
                      args: { tab: "models" }
                    });
                  }}
                  onNewFile={() => {
                    executeCommand({
                      type: "newFile",
                      args: {}
                    });
                  }}
                  onNewStarter={() => { setExamplesOpen(true); }}
                />
              )
              : (
                <ThreadTabs
                  activate={tabs.activate}
                  activeId={tabs.activeId}
                  close={handleCloseTab}
                  closeAll={handleCloseAllTabs}
                  closeOthers={handleCloseOtherTabs}
                  fullScreen={fullScreen}
                  moveToTrash={handleMoveToTrash}
                  onMove={tabs.handleMove}
                  onNewFile={handleNewFile}
                  onToggleSidebar={handleToggleSidebar}
                  onTraceTitleChange={tabs.handleTraceTitleChange}
                  refresh={id => void handleRefreshTab(id)}
                  reorder={tabs.reorder}
                  reveal={handleRevealFile}
                  sidebarOpen={sidebarOpen}
                  tabs={tabs.tabs}
                  toolbarSlot={<UpdateIndicator />}
                />
              )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <FirecrawlLimitDialog />
      <ConfirmDialog
        confirmLabel={
          discardAgentSourcesRequest?.reason === "quit"
            ? "Discard and quit"
            : "Discard and reload"
        }
        description="One or more open source files have unsaved changes."
        onConfirm={() => {
          const request = discardAgentSourcesRequest;
          setDiscardAgentSourcesRequest(null);
          if (request) {
            electrobun.rpc?.send.resolveDiscardDirtyAgentSources({
              requestId: request.requestId,
              discard: true
            });
          }
        }}
        onOpenChange={open => {
          if (open || !discardAgentSourcesRequest) { return; }
          electrobun.rpc?.send.resolveDiscardDirtyAgentSources({
            requestId: discardAgentSourcesRequest.requestId,
            discard: false
          });
          setDiscardAgentSourcesRequest(null);
        }}
        open={discardAgentSourcesRequest !== null}
        title={
          discardAgentSourcesRequest?.reason === "quit"
            ? "Quit and discard unsaved Agent source changes?"
            : "Reload and discard unsaved Agent source changes?"
        }
      />
      <LazyOverlay open={settingsOpen}>
        <SettingsDialog
          onOpenChange={setSettingsOpen}
          onTabChange={setSettingsTab}
          open={settingsOpen}
          tab={settingsTab}
        />
      </LazyOverlay>
      <LazyOverlay open={commandPaletteOpen}>
        <CommandPalette
          blacklist={COMMAND_PALETTE_BLACKLIST}
          onOpenChange={setCommandPaletteOpen}
          open={commandPaletteOpen}
        />
      </LazyOverlay>
      <LazyOverlay open={onboardOpen}>
        <OnboardDialog onOpenChange={setOnboardOpen} open={onboardOpen} />
      </LazyOverlay>
      <LazyOverlay open={examplesOpen}>
        <StartFromExampleDialog
          onOpenChange={setExamplesOpen}
          onSelectExample={example => {
            executeCommand({
              type: "newFileFromPromptExample",
              args: {
                exampleId: example.id,
                parent: examplesParentRef.current
              }
            });
          }}
          open={examplesOpen}
        />
      </LazyOverlay>
      <LazyOverlay open={newAgentProjectOpen}>
        <NewAgentProjectDialog
          onCreated={handleAgentProjectCreated}
          onOpenChange={setNewAgentProjectOpen}
          open={newAgentProjectOpen}
        />
      </LazyOverlay>
      <ExternalAgentProjectTrustDialog
        onConfirm={() => {
          const project = pendingTrust;
          setPendingTrust(null);
          if (project) {
            executeCommand({
              type: "trustExternalAgentProject",
              args: { path: project.path }
            });
          }
        }}
        onOpenChange={open => {
          if (!open) { setPendingTrust(null); }
        }}
        project={pendingTrust}
      />
      {isDraggingFiles
        ? (
          <div className="border-primary bg-primary/10 text-primary pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium backdrop-blur-sm">
            Drop files to import as threads
          </div>
        )
        : null}
    </div>
  );
}
