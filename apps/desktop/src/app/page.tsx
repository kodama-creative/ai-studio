import { FirecrawlLimitDialog } from "@llm-space/ui/components/firecrawl-limit-dialog";
import {
  useModels,
  useRefreshModels,
} from "@llm-space/ui/components/model-provider";
import { getPromptExample } from "@llm-space/ui/components/thread-playground/examples/prompts";
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
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";

import {
  AGENT_PROJECT_CATALOG_CONTROLLER,
  ANALYTICS_CLIENT,
  MAIN_TABS_CONTROLLER,
  PANE_ACTIVITY_TRACKER,
  PLAYGROUND_WORKSPACE_CONTROLLER,
} from "@/app/di/main-window-module";
import { useController, useInject } from "@/app/di/react";
import type { AppTab } from "@/app/tabs/main-tabs-controller";
import { UpdateStatusSurface } from "@/app/updates/update-status-provider";
import { useFullScreen } from "@/app/window/use-full-screen";
import { useCommands, useRegisterCommands } from "@/commands";
import { AccountStatus } from "@/components/account-status";
import { FeatureReminderDialog } from "@/components/feature-reminder-dialog";
import { GithubDeviceDialog } from "@/components/github-device-dialog";
import { GithubStarReminder } from "@/components/github-star-reminder";
import { LazyMount } from "@/components/lazy-mount";
import { PlaygroundSidebar } from "@/components/playground-sidebar";
import { ThreadTabs } from "@/components/thread-tabs";
import { UpdateIndicator } from "@/components/update-indicator";
import { Welcome } from "@/components/welcome";
import { trackAnalytics } from "@/lib/analytics";
import type { SettingsTab } from "@/shared/commands";

import type { PaneLifecycleHost } from "./playground/pane-lifecycle-host";
import {
  closeAllTabsIfAllowed,
  closeOtherTabsIfAllowed,
  closeTabIfAllowed,
  refreshTabIfAllowed,
} from "./playground/pane-mutation-actions";
import { PlaygroundTabPane } from "./playground/playground-tab-pane";
import type { SnapshotDocument } from "./playground/playground-workspace-controller";

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
const ShareThreadDialog = lazy(() =>
  import("@/components/share-thread-dialog").then((m) => ({
    default: m.ShareThreadDialog,
  }))
);

export function MainWindowPage() {
  return (
    <>
      <PageWorkspace />
      <UpdateStatusSurface />
    </>
  );
}

// Commands that need context the palette can't supply (a file path / URL) or
// that make no sense to invoke from the palette itself.
const COMMAND_PALETTE_BLACKLIST = [
  "shell.openLink",
  "app.openCommandPalette",
  "thread.openVariables",
  "playground.createFromExample",
  "tabs.close",
  "tabs.closeOthers",
  "project.createThread",
  "project.forkThread",
  // Only meaningful from the "ready to install" toast; a bare palette
  // invocation would silently no-op (or restart mid-work).
  "updates.applyAndRestart",
];

/** Whether a drag carries OS files that may contain Thread snapshots. */
function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

// Persisted width (in px) of the Playground/Agent Project sidebar, so it survives
// restarts. Collapsing sets the panel to 0 — we never store that, so reopening
// restores the last dragged width.
const DEFAULT_SIDEBAR_SIZE = "16.7%";

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

function PageWorkspace() {
  const paneActivityTracker = useInject(PANE_ACTIVITY_TRACKER);
  const { controller: tabsController, state: tabState } =
    useController(MAIN_TABS_CONTROLLER);
  const openPlayground = useCallback(
    (playgroundId: string, title: string) =>
      tabsController.dispatch({
        type: "open",
        playgroundId,
        title,
      }),
    [tabsController]
  );
  const close = useCallback(
    (id: string) => tabsController.dispatch({ type: "close", id }),
    [tabsController]
  );
  const closeOthers = useCallback(
    (keepId: string) =>
      tabsController.dispatch({ type: "closeOthers", keepId }),
    [tabsController]
  );
  const closeAll = useCallback(
    () => tabsController.dispatch({ type: "closeAll" }),
    [tabsController]
  );
  const agentProjectCatalog = useController(
    AGENT_PROJECT_CATALOG_CONTROLLER
  ).state;
  const analytics = useInject(ANALYTICS_CLIENT);
  const { controller: playgroundWorkspace, state: playgroundCatalog } =
    useController(PLAYGROUND_WORKSPACE_CONTROLLER);
  const { executeCommand } = useCommands();
  const models = useModels();
  const refreshModels = useRefreshModels();

  const visibleTabs = tabState.tabs;
  const visibleActiveId = tabState.activeId;
  const activateVisibleTab = useCallback(
    (id: string) => {
      tabsController.dispatch({ type: "activate", id });
    },
    [tabsController]
  );
  const reorderVisibleTabs = useCallback(
    (from: number, to: number) =>
      tabsController.dispatch({ type: "reorder", from, to }),
    [tabsController]
  );
  const showPaneBusy = useCallback((action: string) => {
    toast.info("Wait for active runs to finish", {
      description: `Completed output will be saved before ${action}.`,
    });
  }, []);
  const handlePaneRunStart = useCallback(
    (paneId: string, runId: string) =>
      paneActivityTracker.beginRun(paneId, runId),
    [paneActivityTracker]
  );
  const handlePaneRunSettled = useCallback(
    (paneId: string, runId: string) => {
      paneActivityTracker.settleRun(paneId, runId);
    },
    [paneActivityTracker]
  );
  const handlePanePersistenceChange = useCallback(
    (paneId: string, owner: object, busy: boolean) => {
      paneActivityTracker.setPersistenceBusy(paneId, owner, busy);
    },
    [paneActivityTracker]
  );
  const isPaneMutationReserved = useCallback(
    (paneId: string) => paneActivityTracker.isMutationReserved(paneId),
    [paneActivityTracker]
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
    if (settingsOpen) {
      trackAnalytics(analytics, { event: "settings_opened", properties: {} });
    }
  }, [analytics, settingsOpen]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [sharePath, setSharePath] = useState<string | null>(null);
  // Snapshot import: a hidden picker opened by the import command plus
  // page-wide OS drag-and-drop state.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const handleImportFiles = useCallback(
    (files: FileList | readonly SnapshotDocument[]) => {
      void playgroundWorkspace.importDocuments([...files]);
    },
    [playgroundWorkspace]
  );
  // Register command handlers backed by page-level state (Playgrounds, tabs,
  // sidebar, and settings).
  useRegisterCommands({
    "playground.create": () => void playgroundWorkspace.createBlank(),
    "playground.createFromExample": ({ exampleId }) => {
      const example = getPromptExample(exampleId);
      if (example === undefined) return;
      void playgroundWorkspace.createFromExample(example);
    },
    "tabs.close": ({ id }) => {
      const current = tabsController.getSnapshot();
      const target = id ?? current.activeId;
      if (!target) return;
      closeTabIfAllowed({
        tracker: paneActivityTracker,
        tabs: current.tabs,
        targetId: target,
        onBlocked: () => showPaneBusy("closing this tab"),
        close,
      });
    },
    "tabs.closeOthers": ({ id }) => {
      const current = tabsController.getSnapshot();
      const target = id ?? current.activeId;
      if (!target) return;
      closeOtherTabsIfAllowed({
        tracker: paneActivityTracker,
        tabs: current.tabs,
        keepId: target,
        onBlocked: () => showPaneBusy("closing other tabs"),
        closeOthers,
      });
    },
    "tabs.closeAll": () => {
      const current = tabsController.getSnapshot();
      closeAllTabsIfAllowed({
        tracker: paneActivityTracker,
        tabs: current.tabs,
        onBlocked: () => showPaneBusy("closing all tabs"),
        closeAll,
      });
    },
    "tabs.reopenClosed": () =>
      tabsController.dispatch({ type: "reopenClosed" }),
    "tabs.selectNext": () =>
      tabsController.dispatch({ type: "activateSibling", offset: 1 }),
    "tabs.selectPrevious": () =>
      tabsController.dispatch({ type: "activateSibling", offset: -1 }),
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
    "playground.openExamples": () => setExamplesOpen(true),
    "playground.importFiles": ({ files }) => {
      if (files) {
        void handleImportFiles(files);
        return;
      }
      fileInputRef.current?.click();
    },
    "thread.share": ({ path }) => {
      if (path !== undefined) {
        setSharePath(path);
        return;
      }
      const current = tabsController.getSnapshot();
      const active = current.tabs.find((tab) => tab.id === current.activeId);
      if (active !== undefined) {
        setSharePath(`playgrounds/${active.playgroundId}`);
      }
    },
  });

  // On a fresh launch with no configured models, prompt onboarding. Runs once on
  // mount; adding or removing providers afterwards won't re-trigger it.
  // Deps intentionally empty: this is a one-shot startup check, not reactive.
  useEffect(() => {
    if (models.length === 0) setOnboardOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot startup check; must not re-run when models change
  }, []);

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
      const current = tabsController.getSnapshot();
      const tab = current.tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      const reservation = refreshTabIfAllowed({
        tracker: paneActivityTracker,
        tabs: current.tabs,
        targetId: tab.id,
        onBlocked: () => showPaneBusy("refreshing this tab"),
        refresh: (targetId) =>
          tabsController.dispatch({ type: "refresh", id: targetId }),
      });
      if (reservation) {
        refreshReservationsRef.current.set(
          reservation.paneId,
          reservation.release
        );
      }
    },
    [paneActivityTracker, showPaneBusy, tabsController]
  );
  const handlePaneRefreshSettled = useCallback((paneId: string) => {
    const release = refreshReservationsRef.current.get(paneId);
    if (!release) return;
    refreshReservationsRef.current.delete(paneId);
    release();
  }, []);
  const handlePlaygroundTitleChange = useCallback(
    (playgroundId: string, title: string) =>
      tabsController.dispatch({
        type: "renamePlayground",
        playgroundId,
        title,
      }),
    [tabsController]
  );
  const paneLifecycleHost = useMemo<PaneLifecycleHost>(
    () => ({
      isMutationReserved: isPaneMutationReserved,
      subscribeToActivityChanges: paneActivityTracker.subscribe,
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
      paneActivityTracker,
    ]
  );
  const renderPlaygroundPane = useCallback(
    (tab: AppTab, active: boolean) => (
      <PlaygroundTabPane
        tabId={tab.id}
        paneId={tab.paneId}
        playgroundId={tab.playgroundId}
        active={active}
        lifecycleHost={paneLifecycleHost}
        refreshNonce={tab.refreshNonce ?? 0}
        onClose={close}
        onTitleChange={handlePlaygroundTitleChange}
        onPlaygroundChange={playgroundWorkspace.acceptProjection}
      />
    ),
    [
      close,
      handlePlaygroundTitleChange,
      paneLifecycleHost,
      playgroundWorkspace.acceptProjection,
    ]
  );
  useEffect(
    () => () => {
      refreshReservationsRef.current.forEach((release) => release());
      refreshReservationsRef.current.clear();
    },
    []
  );
  const handleNewPlayground = useCallback(() => {
    void playgroundWorkspace.createBlank();
  }, [playgroundWorkspace]);
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
        void handleImportFiles(e.dataTransfer.files);
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
            void handleImportFiles(files);
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
              playgrounds={playgroundCatalog.playgrounds}
              loadingPlaygrounds={playgroundCatalog.loading}
              projects={agentProjectCatalog.projects}
              loadingProjects={agentProjectCatalog.loading}
              onOpen={(playground) =>
                openPlayground(playground.id, playground.title)
              }
              onCreate={() => void playgroundWorkspace.createBlank()}
            />
            <AccountStatus />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize={640}>
            <ThreadTabs
              tabs={visibleTabs}
              paneTabs={tabState.tabs}
              emptyState={
                <Welcome
                  onNewStarter={() => setExamplesOpen(true)}
                  onNewPlayground={() => void playgroundWorkspace.createBlank()}
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
              onNewPlayground={handleNewPlayground}
              onToggleSidebar={handleToggleSidebar}
              renderPane={renderPlaygroundPane}
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
            void playgroundWorkspace.createFromExample(example);
          }}
        />
      </LazyMount>
      <LazyMount open={sharePath !== null}>
        <ShareThreadDialog
          open={sharePath !== null}
          path={sharePath ?? ""}
          onOpenChange={(open) => {
            if (!open) setSharePath(null);
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
