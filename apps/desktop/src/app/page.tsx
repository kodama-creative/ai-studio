import { parsePortableThreadSnapshot, type Thread } from "@llm-space/core";
import type { AgentSpec } from "@llm-space/studio";
import { FirecrawlLimitDialog } from "@llm-space/ui/components/firecrawl-limit-dialog";
import {
  useModels,
  useRefreshModels,
} from "@llm-space/ui/components/model-provider";
import {
  getPromptExample,
  resolveSeed,
} from "@llm-space/ui/components/thread-playground/examples/prompts";
import { useHostServices } from "@llm-space/ui/host";
import {
  LOCAL_STORAGE_KEYS,
  readLocalStorage,
  writeLocalStorage,
} from "@llm-space/ui/lib/local-storage";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@llm-space/ui/ui/resizable";
import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";

import { createAgentProjectClient } from "@/client/agent-project-client";
import { createPlaygroundClient } from "@/client/playground-client";
import { importThreadSnapshot } from "@/client/share";
import { CommandProvider, useCommands, useRegisterCommands } from "@/commands";
import { AccountStatus } from "@/components/account-status";
import { FeatureReminderDialog } from "@/components/feature-reminder-dialog";
import { GithubAuthProvider } from "@/components/github-auth-provider";
import { GithubDeviceDialog } from "@/components/github-device-dialog";
import { GithubStarReminder } from "@/components/github-star-reminder";
import { LazyMount } from "@/components/lazy-mount";
import { PlaygroundSidebar } from "@/components/playground-sidebar";
import {
  ThreadTabs,
  useThreadTabs,
  type AppTab,
} from "@/components/thread-tabs";
import type { PaneLifecycleHost } from "@/components/thread-tabs/pane-lifecycle-host";
import {
  closeAllTabsIfAllowed,
  closeOtherTabsIfAllowed,
  closeTabIfAllowed,
  paneIdForTab,
  refreshTabIfAllowed,
} from "@/components/thread-tabs/pane-mutation-actions";
import { RuntimeRunTracker } from "@/components/thread-tabs/runtime-run-tracker";
import { UpdateIndicator } from "@/components/update-indicator";
import { UpdateStatusProvider } from "@/components/update-status-provider";
import { Welcome } from "@/components/welcome";
import {
  createElectrobunModelClient,
  DesktopHostProvider,
} from "@/host/host-services";
import { track } from "@/lib/analytics";
import { electrobun } from "@/lib/electrobun";
import { useFullScreen } from "@/lib/use-full-screen";
import type { SettingsTab } from "@/shared/commands";
import type { RuntimeId } from "@/shared/runtime";

import { WorkspaceModelScope } from "./workspace-model-scope";

// Overlay surfaces that aren't part of the first paint — settings, the command
// palette, onboarding, and examples. Loaded lazily so their code (and heavy
// deps like the color picker and cmdk) stays out of the initial chunk until
// first opened.
const SettingsDialog = lazy(() =>
  import("@/components/settings/settings-dialog").then((m) => ({
    default: m.SettingsDialog,
  }))
);
const CommandPalette = lazy(() =>
  import("@/components/command-palette").then((m) => ({
    default: m.CommandPalette,
  }))
);
const OnboardDialog = lazy(() =>
  import("@/components/onboard-dialog").then((m) => ({
    default: m.OnboardDialog,
  }))
);
const StartFromExampleDialog = lazy(() =>
  import("@/components/start-from-example-dialog").then((m) => ({
    default: m.StartFromExampleDialog,
  }))
);

export function Page() {
  return (
    <CommandProvider>
      <DesktopHostProvider>
        <UpdateStatusProvider>
          <GithubAuthProvider>
            <PageInner />
          </GithubAuthProvider>
        </UpdateStatusProvider>
      </DesktopHostProvider>
    </CommandProvider>
  );
}

// Commands that need context the palette can't supply (a file path / URL) or
// that make no sense to invoke from the palette itself.
const COMMAND_PALETTE_BLACKLIST = [
  "workspace.rename",
  "workspace.duplicate",
  "workspace.delete",
  "workspace.reveal",
  "workspace.revealInTree",
  "workspace.copyFile",
  "shell.openLink",
  "app.openCommandPalette",
  "thread.openVariables",
  "workspace.newFileFromPromptExample",
  "tabs.close",
  "tabs.closeOthers",
  "project.createThread",
  "project.forkThread",
  // Only meaningful from the "ready to install" toast; a bare palette
  // invocation would silently no-op (or restart mid-work).
  "updates.applyAndRestart",
];

/** Whether a drag carries OS files (vs. the tree's internal node-reorder drag). */
function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

// Persisted width (in px) of the sidebar file-tree panel, so it survives
// restarts. Collapsing sets the panel to 0 — we never store that, so reopening
// restores the last dragged width.
const DEFAULT_SIDEBAR_SIZE = "16.7%";

const BLANK_AGENT_SPEC: AgentSpec = {
  schemaVersion: 1,
  instructions: [],
  tools: [],
};

function readSidebarSize(): number | string {
  const raw = readLocalStorage(LOCAL_STORAGE_KEYS.sidebarSize);
  const size = raw ? Number(raw) : NaN;
  if (Number.isFinite(size) && size > 0) return size;
  return DEFAULT_SIDEBAR_SIZE;
}

function writeSidebarSize(sizeInPixels: number): void {
  writeLocalStorage(
    LOCAL_STORAGE_KEYS.sidebarSize,
    String(Math.round(sizeInPixels))
  );
}

function PageInner() {
  return (
    <WorkspaceModelScope
      runtimeId="local"
      createClient={createElectrobunModelClient}
    >
      <_PageWorkspace />
    </WorkspaceModelScope>
  );
}

function _PageWorkspace() {
  const workspaceRuntimeIdRef = useRef<RuntimeId>("local");
  const runtimeRunTrackerRef = useRef(new RuntimeRunTracker());
  const mutationRevision = useSyncExternalStore(
    runtimeRunTrackerRef.current.subscribe,
    runtimeRunTrackerRef.current.getSnapshot,
    runtimeRunTrackerRef.current.getSnapshot
  );
  const canPruneRestoredTab = useCallback((tab: AppTab) => {
    const paneId = paneIdForTab(tab);
    return (
      !runtimeRunTrackerRef.current.isPaneBusy(paneId) &&
      !runtimeRunTrackerRef.current.isMutationReserved(
        paneId,
        tab.runtimeId
      )
    );
  }, []);
  const tabs = useThreadTabs({ canPruneRestoredTab });
  const playgroundClient = useMemo(() => createPlaygroundClient(), []);
  const agentProjectClient = useMemo(() => createAgentProjectClient(), []);
  const seedHost = useHostServices();
  const { executeCommand } = useCommands();
  const models = useModels();
  const refreshModels = useRefreshModels();
  const queryClient = useQueryClient();

  const {
    close,
    closeAll,
    closeOthers,
    reopenClosed,
    openPlayground,
  } = tabs;
  const visibleTabs = tabs.tabs;
  const visibleActiveId = tabs.activeId;
  // The visible active tab is read through a ref so command handlers never go
  // stale or accidentally target a tab from another runtime.
  const activeTabIdRef = useRef(visibleActiveId);
  const allTabsRef = useRef(tabs.tabs);
  useEffect(() => {
    activeTabIdRef.current = visibleActiveId;
  }, [visibleActiveId]);
  useEffect(() => {
    allTabsRef.current = tabs.tabs;
  }, [tabs.tabs]);
  const activateVisibleTab = useCallback(
    (id: string) => {
      if (visibleTabs.some((tab) => tab.id === id)) tabs.activate(id);
    },
    [tabs, visibleTabs]
  );
  const reorderVisibleTabs = useCallback(
    (from: number, to: number) =>
      tabs.reorder(from, to),
    [tabs]
  );
  const activateVisibleSibling = useCallback(
    (offset: 1 | -1) => {
      if (visibleTabs.length === 0) return;
      const index = visibleTabs.findIndex((tab) => tab.id === visibleActiveId);
      const next =
        index === -1
          ? offset === 1
            ? visibleTabs[0]
            : visibleTabs[visibleTabs.length - 1]
          : visibleTabs[
              (index + offset + visibleTabs.length) % visibleTabs.length
            ];
      if (next) tabs.activate(next.id);
    },
    [tabs, visibleActiveId, visibleTabs]
  );
  const showRuntimeRunBlocked = useCallback((action: string) => {
    toast.info("Wait for active runs to finish", {
      description: `Completed output will be saved before ${action}.`,
    });
  }, []);
  const handlePaneRunStart = useCallback(
    (paneId: string, runtimeId: RuntimeId, runId: string, path?: string) =>
      runtimeRunTrackerRef.current.beginRun(paneId, runtimeId, runId, path),
    []
  );
  const handlePaneRunSettled = useCallback((paneId: string, runId: string) => {
    runtimeRunTrackerRef.current.settleRun(paneId, runId);
  }, []);
  const handlePanePersistenceChange = useCallback(
    (
      paneId: string,
      runtimeId: RuntimeId,
      owner: object,
      busy: boolean,
      path?: string
    ) => {
      runtimeRunTrackerRef.current.setPersistenceBusy(
        paneId,
        runtimeId,
        owner,
        busy,
        path
      );
    },
    []
  );
  const isPaneMutationReserved = useCallback(
    (paneId: string, runtimeId: RuntimeId, path?: string) =>
      runtimeRunTrackerRef.current.isMutationReserved(paneId, runtimeId, path),
    []
  );
  // Collapse / expand the left side panel. The initial width is recovered from
  // localStorage once (lazy ref init) and fed straight into `defaultSize`, so
  // restoring it costs no extra render on startup.
  const sidebarPanelRef = usePanelRef();
  const defaultSidebarSize = useRef(readSidebarSize());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [sidebarPanelRef]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setSettingsOpen(open);
      if (!open) void refreshModels();
    },
    [refreshModels]
  );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  // One event per open transition, no matter which command opened Settings.
  useEffect(() => {
    if (settingsOpen) track({ event: "settings_opened", properties: {} });
  }, [settingsOpen]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  // Which folder a chosen example's thread is created into (default: root).
  const examplesParentRef = useRef("");
  const createLocalPlayground = useCallback(
    async (input?: {
      readonly title?: string;
      readonly agentSpec?: AgentSpec;
      readonly messages?: NonNullable<Thread["context"]>["messages"];
    }) => {
      try {
        const playground = await playgroundClient.create({
          title: input?.title,
          agentSpec: input?.agentSpec ?? BLANK_AGENT_SPEC,
          conversation: {
            messages: input?.messages ?? [
              {
                id: crypto.randomUUID(),
                role: "user",
                content: [{ type: "text", text: "" }],
              },
            ],
            state: {},
          },
        });
        await queryClient.invalidateQueries({ queryKey: ["playgrounds"] });
        openPlayground(playground.id, playground.title);
      } catch (cause) {
        toast.error("Unable to create Playground", {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [openPlayground, playgroundClient, queryClient]
  );

  // File import: a hidden picker (opened by the `importFiles` command), the
  // parent directory it should import into, and page-wide drag-and-drop state.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingParentRef = useRef("");
  const pendingImportRuntimeIdRef = useRef<RuntimeId>("local");
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const handleImportFiles = useCallback(
    async (
      files: FileList | (File | { name: string; text: string })[],
      _parent: string,
      _runtimeId: RuntimeId = workspaceRuntimeIdRef.current
    ) => {
      if (_runtimeId !== "local") return;
      const list = [...files];
      if (list.length === 0) return;
      let imported = 0;
      for (const file of list) {
        try {
          const text = file instanceof File ? await file.text() : file.text;
          const snapshot = parsePortableThreadSnapshot(JSON.parse(text));
          const playground = await importThreadSnapshot(snapshot);
          openPlayground(playground.id, playground.title);
          imported += 1;
        } catch {
          // Invalid snapshots are counted below and do not affect valid files.
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["playgrounds"] });
      if (imported === 0) {
        toast.error("No valid LLM Space Thread Snapshots were selected.");
      } else {
        toast.success(
          `Imported ${imported} Playground${imported === 1 ? "" : "s"}`
        );
      }
    },
    [
      openPlayground,
      queryClient,
    ]
  );
  // Register the command handlers backed by page-level state (tabs, sidebar,
  // settings). `newFile` / `newFolder` / the tree ops are registered by the
  // file tree, which owns that state.
  useRegisterCommands({
    "workspace.newFile": ({ runtimeId }) => {
      const targetRuntimeId = runtimeId ?? workspaceRuntimeIdRef.current;
      if (targetRuntimeId === "local") void createLocalPlayground();
    },
    "workspace.newFileFromPromptExample": ({ exampleId, runtimeId }) => {
      const targetRuntimeId = runtimeId ?? workspaceRuntimeIdRef.current;
      if (targetRuntimeId !== "local") return;
      const example = getPromptExample(exampleId);
      if (example === undefined) return;
      void (async () => {
        const [instructions, tools, messages, textVariables] =
          await Promise.all([
            resolveSeed(example.content, seedHost),
            resolveSeed(example.tools, seedHost),
            resolveSeed(example.messages, seedHost),
            resolveSeed(example.textVariables, seedHost),
          ]);
        await createLocalPlayground({
          title: example.label,
          agentSpec: {
            schemaVersion: 1,
            instructions: instructions ? [instructions] : [],
            tools: tools ?? [],
            ...(textVariables === undefined
              ? {}
              : {
                  variableVariants: {
                    active: "default",
                    variants: { default: textVariables },
                  },
                }),
          },
          messages,
        });
      })();
    },
    "tabs.close": ({ id, path, runtimeId }) => {
      void path;
      void runtimeId;
      const target = id ?? activeTabIdRef.current;
      if (!target) return;
      closeTabIfAllowed({
        tracker: runtimeRunTrackerRef.current,
        tabs: tabs.tabs,
        targetId: target,
        onBlocked: () => showRuntimeRunBlocked("closing this tab"),
        close,
      });
    },
    "tabs.closeOthers": ({ id, path, runtimeId }) => {
      void path;
      void runtimeId;
      const target = id ?? activeTabIdRef.current;
      if (!target) return;
      closeOtherTabsIfAllowed({
        tracker: runtimeRunTrackerRef.current,
        tabs: tabs.tabs,
        keepId: target,
        onBlocked: () => showRuntimeRunBlocked("closing other tabs"),
        closeOthers,
      });
    },
    "tabs.closeAll": () => {
      closeAllTabsIfAllowed({
        tracker: runtimeRunTrackerRef.current,
        tabs: tabs.tabs,
        onBlocked: () => showRuntimeRunBlocked("closing all tabs"),
        closeAll,
      });
    },
    "tabs.reopenClosed": () => void reopenClosed(),
    "tabs.selectNext": () => activateVisibleSibling(1),
    "tabs.selectPrevious": () => activateVisibleSibling(-1),
    "layout.toggleSidebar": () => toggleSidebar(),
    "app.openSettings": ({ tab }) => {
      if (tab) setSettingsTab(tab);
      setSettingsOpen(true);
    },
    "app.openModelSettings": () => {
      setSettingsTab("models");
      setSettingsOpen(true);
    },
    "app.openCommandPalette": () => setCommandPaletteOpen(true),
    "app.openOnboard": () => setOnboardOpen(true),
    "workspace.openStartFromExample": ({ parent = "", runtimeId }) => {
      if (runtimeId && runtimeId !== "local") return;
      examplesParentRef.current = parent;
      setExamplesOpen(true);
    },
    "workspace.importFiles": ({ parent = "", files, runtimeId }) => {
      const targetRuntimeId = runtimeId ?? workspaceRuntimeIdRef.current;
      if (targetRuntimeId !== workspaceRuntimeIdRef.current) return;
      if (files) {
        void handleImportFiles(files, parent, targetRuntimeId);
        return;
      }
      pendingParentRef.current = parent;
      pendingImportRuntimeIdRef.current = targetRuntimeId;
      fileInputRef.current?.click();
    },
  });

  // On a fresh launch with no configured models, prompt onboarding. Runs once on
  // mount; adding or removing providers afterwards won't re-trigger it.
  // Deps intentionally empty: this is a one-shot startup check, not reactive.
  useEffect(() => {
    if (models.length === 0) setOnboardOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot startup check; must not re-run when models change
  }, []);

  // Bridge commands dispatched from the bun process (native menu / shortcuts)
  // into the renderer dispatcher.
  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) return;
    rpc.addMessageListener("executeCommand", executeCommand);
    return () => rpc.removeMessageListener("executeCommand", executeCommand);
  }, [executeCommand]);

  const fullScreen = useFullScreen();
  const handleCloseTab = useCallback(
    (id: string) => executeCommand({ type: "tabs.close", args: { id } }),
    [executeCommand]
  );
  const handleCloseOtherTabs = useCallback(
    (id: string) => executeCommand({ type: "tabs.closeOthers", args: { id } }),
    [executeCommand]
  );
  const handleCloseAllTabs = useCallback(
    () => executeCommand({ type: "tabs.closeAll", args: {} }),
    [executeCommand]
  );
  const refreshReservationsRef = useRef(new Map<string, () => void>());
  const handleRefreshTab = useCallback(
    (id: string) => {
      const tab = tabs.tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      const reservation = refreshTabIfAllowed({
        tracker: runtimeRunTrackerRef.current,
        tabs: tabs.tabs,
        targetId: tab.id,
        onBlocked: () => showRuntimeRunBlocked("refreshing this tab"),
        refresh: tabs.refresh,
      });
      if (reservation) {
        refreshReservationsRef.current.set(
          reservation.paneId,
          reservation.release
        );
      }
    },
    [showRuntimeRunBlocked, tabs]
  );
  const handlePaneRefreshSettled = useCallback((paneId: string) => {
    const release = refreshReservationsRef.current.get(paneId);
    if (!release) return;
    refreshReservationsRef.current.delete(paneId);
    release();
  }, []);
  const paneLifecycleHost = useMemo<PaneLifecycleHost>(
    () => ({
      isMutationReserved: isPaneMutationReserved,
      onPersistenceChange: handlePanePersistenceChange,
      onRefreshSettled: handlePaneRefreshSettled,
      onRunSettled: handlePaneRunSettled,
      onRunStart: handlePaneRunStart,
    }),
    [
      handlePanePersistenceChange,
      handlePaneRefreshSettled,
      handlePaneRunSettled,
      handlePaneRunStart,
      isPaneMutationReserved,
    ]
  );
  useEffect(
    () => () => {
      refreshReservationsRef.current.forEach((release) => release());
      refreshReservationsRef.current.clear();
    },
    []
  );
  const handleNewFile = useCallback(() => {
    void createLocalPlayground();
  }, [createLocalPlayground]);
  const handleToggleSidebar = useCallback(
    () => executeCommand({ type: "layout.toggleSidebar", args: {} }),
    [executeCommand]
  );
  return (
    <div
      className="relative flex size-full flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
        }
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        void handleImportFiles(
          e.dataTransfer.files,
          "",
          workspaceRuntimeIdRef.current
        );
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".json,.jsonl,application/json,application/x-ndjson"
        aria-label="Import thread files"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) {
            void handleImportFiles(
              files,
              pendingParentRef.current,
              pendingImportRuntimeIdRef.current
            );
          }
          e.target.value = "";
        }}
      />
      <main className="min-h-0 grow">
        <ResizablePanelGroup>
          <ResizablePanel
            className="bg-sidebar flex flex-col"
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={defaultSidebarSize.current}
            minSize={200}
            onResize={(size) => {
              setSidebarOpen(size.inPixels > 0);
              // Persist the dragged width, but never the collapsed (0) state so
              // reopening restores the last real width.
              if (size.inPixels > 0) writeSidebarSize(size.inPixels);
            }}
          >
            <PlaygroundSidebar
              client={playgroundClient}
              projectClient={agentProjectClient}
              onOpen={(playground) =>
                openPlayground(playground.id, playground.title)
              }
              onCreate={() => void createLocalPlayground()}
            />
            <AccountStatus />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize={640}>
            <ThreadTabs
              tabs={visibleTabs}
              paneTabs={tabs.tabs}
              emptyState={
                <Welcome
                  onNewStarter={() => setExamplesOpen(true)}
                  onNewFile={() =>
                    void createLocalPlayground()
                  }
                  onModels={() =>
                    executeCommand({
                      type: "app.openSettings",
                      args: { tab: "models" },
                    })
                  }
                />
              }
              activeId={visibleActiveId}
              activate={activateVisibleTab}
              refresh={handleRefreshTab}
              sidebarOpen={sidebarOpen}
              fullScreen={fullScreen}
              close={handleCloseTab}
              closeOthers={handleCloseOtherTabs}
              closeAll={handleCloseAllTabs}
              reorder={reorderVisibleTabs}
              onNewFile={handleNewFile}
              onPlaygroundTitleChange={tabs.handlePlaygroundTitleChange}
              onToggleSidebar={handleToggleSidebar}
              lifecycleHost={paneLifecycleHost}
              mutationRevision={mutationRevision}
              toolbarSlot={<UpdateIndicator />}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <FirecrawlLimitDialog />
      <GithubDeviceDialog />
      <GithubStarReminder />
      <FeatureReminderDialog />
      <LazyMount open={settingsOpen}>
        <SettingsDialog
          tab={settingsTab}
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
          onTabChange={setSettingsTab}
        />
      </LazyMount>
      <LazyMount open={commandPaletteOpen}>
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          blacklist={COMMAND_PALETTE_BLACKLIST}
        />
      </LazyMount>
      <LazyMount open={onboardOpen}>
        <OnboardDialog open={onboardOpen} onOpenChange={setOnboardOpen} />
      </LazyMount>
      <LazyMount open={examplesOpen}>
        <StartFromExampleDialog
          open={examplesOpen}
          onOpenChange={setExamplesOpen}
          onSelectExample={(example) => {
            void (async () => {
              const [instructions, tools, messages, textVariables] =
                await Promise.all([
                  resolveSeed(example.content, seedHost),
                  resolveSeed(example.tools, seedHost),
                  resolveSeed(example.messages, seedHost),
                  resolveSeed(example.textVariables, seedHost),
                ]);
              await createLocalPlayground({
                title: example.label,
                agentSpec: {
                  schemaVersion: 1,
                  instructions: instructions ? [instructions] : [],
                  tools: tools ?? [],
                  ...(textVariables === undefined
                    ? {}
                    : {
                        variableVariants: {
                          active: "default",
                          variants: { default: textVariables },
                        },
                      }),
                },
                messages,
              });
            })();
          }}
        />
      </LazyMount>
      {isDraggingFiles && (
        <div className="border-primary bg-primary/10 text-primary pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium backdrop-blur-sm">
          Drop files to import as threads
        </div>
      )}
    </div>
  );
}
