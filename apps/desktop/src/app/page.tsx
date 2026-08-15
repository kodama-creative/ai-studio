import { FirecrawlLimitDialog } from "@llm-space/ui/components/firecrawl-limit-dialog";
import {
  useModels,
  useRefreshModels,
} from "@llm-space/ui/components/model-provider";
import {
  getPromptExample,
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
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";

import { createAgentProjectClient } from "@/client/agent-project-client";
import { createPlaygroundClient } from "@/client/playground-client";
import { importThreadSnapshot } from "@/client/share";
import { useCommands, useRegisterCommands } from "@/commands";
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
import { PaneActivityTracker } from "@/components/thread-tabs/pane-activity-tracker";
import type { PaneLifecycleHost } from "@/components/thread-tabs/pane-lifecycle-host";
import {
  closeAllTabsIfAllowed,
  closeOtherTabsIfAllowed,
  closeTabIfAllowed,
  paneIdForTab,
  refreshTabIfAllowed,
} from "@/components/thread-tabs/pane-mutation-actions";
import { UpdateIndicator } from "@/components/update-indicator";
import { UpdateStatusProvider } from "@/components/update-status-provider";
import { Welcome } from "@/components/welcome";
import { track } from "@/lib/analytics";
import { useFullScreen } from "@/lib/use-full-screen";
import type { SettingsTab } from "@/shared/commands";

import {
  PlaygroundWorkspaceController,
  type SnapshotDocument,
} from "./playground/playground-workspace-controller";

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
    <UpdateStatusProvider>
      <GithubAuthProvider>
        <PageWorkspace />
      </GithubAuthProvider>
    </UpdateStatusProvider>
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
  const paneActivityTrackerRef = useRef(new PaneActivityTracker());
  const canPruneRestoredTab = useCallback((tab: AppTab) => {
    const paneId = paneIdForTab(tab);
    return (
      !paneActivityTrackerRef.current.isPaneBusy(paneId) &&
      !paneActivityTrackerRef.current.isMutationReserved(paneId)
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

  const { close, closeAll, closeOthers, reopenClosed, openPlayground } = tabs;
  const visibleTabs = tabs.tabs;
  const visibleActiveId = tabs.activeId;
  // The visible active tab is read through a ref so command handlers never go
  // stale or accidentally target a previously active tab.
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
    (from: number, to: number) => tabs.reorder(from, to),
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
  const showPaneBusy = useCallback((action: string) => {
    toast.info("Wait for active runs to finish", {
      description: `Completed output will be saved before ${action}.`,
    });
  }, []);
  const handlePaneRunStart = useCallback(
    (paneId: string, runId: string) =>
      paneActivityTrackerRef.current.beginRun(paneId, runId),
    []
  );
  const handlePaneRunSettled = useCallback((paneId: string, runId: string) => {
    paneActivityTrackerRef.current.settleRun(paneId, runId);
  }, []);
  const handlePanePersistenceChange = useCallback(
    (paneId: string, owner: object, busy: boolean) => {
      paneActivityTrackerRef.current.setPersistenceBusy(paneId, owner, busy);
    },
    []
  );
  const isPaneMutationReserved = useCallback(
    (paneId: string) =>
      paneActivityTrackerRef.current.isMutationReserved(paneId),
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
  const [sharePath, setSharePath] = useState<string | null>(null);
  const playgroundWorkspace = useMemo(
    () =>
      new PlaygroundWorkspaceController({
        client: playgroundClient,
        importSnapshot: importThreadSnapshot,
        seedHost,
        refreshCatalog: () =>
          queryClient.invalidateQueries({ queryKey: ["playgrounds"] }),
        openPlayground: (playground) =>
          openPlayground(playground.id, playground.title),
        notifySuccess: (message) => toast.success(message),
        notifyError: (title, error) =>
          toast.error(title, {
            ...(error === undefined
              ? {}
              : {
                  description:
                    error instanceof Error
                      ? error.message
                      : "Please try again.",
                }),
          }),
      }),
    [openPlayground, playgroundClient, queryClient, seedHost]
  );

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
      const target = id ?? activeTabIdRef.current;
      if (!target) return;
      closeTabIfAllowed({
        tracker: paneActivityTrackerRef.current,
        tabs: tabs.tabs,
        targetId: target,
        onBlocked: () => showPaneBusy("closing this tab"),
        close,
      });
    },
    "tabs.closeOthers": ({ id }) => {
      const target = id ?? activeTabIdRef.current;
      if (!target) return;
      closeOtherTabsIfAllowed({
        tracker: paneActivityTrackerRef.current,
        tabs: tabs.tabs,
        keepId: target,
        onBlocked: () => showPaneBusy("closing other tabs"),
        closeOthers,
      });
    },
    "tabs.closeAll": () => {
      closeAllTabsIfAllowed({
        tracker: paneActivityTrackerRef.current,
        tabs: tabs.tabs,
        onBlocked: () => showPaneBusy("closing all tabs"),
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
      const active = allTabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current
      );
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
      const tab = tabs.tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      const reservation = refreshTabIfAllowed({
        tracker: paneActivityTrackerRef.current,
        tabs: tabs.tabs,
        targetId: tab.id,
        onBlocked: () => showPaneBusy("refreshing this tab"),
        refresh: tabs.refresh,
      });
      if (reservation) {
        refreshReservationsRef.current.set(
          reservation.paneId,
          reservation.release
        );
      }
    },
    [showPaneBusy, tabs]
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
      subscribeToMutationChanges: paneActivityTrackerRef.current.subscribe,
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
              client={playgroundClient}
              projectClient={agentProjectClient}
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
              paneTabs={tabs.tabs}
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
              onPlaygroundTitleChange={tabs.handlePlaygroundTitleChange}
              onToggleSidebar={handleToggleSidebar}
              lifecycleHost={paneLifecycleHost}
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
