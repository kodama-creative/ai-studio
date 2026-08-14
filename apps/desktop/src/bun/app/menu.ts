import {
  ApplicationMenu,
  type ApplicationMenuItemConfig,
  BrowserWindow,
} from "electrobun/bun";

import type { Command } from "../../shared/commands";

import { isChineseLocale } from "./locales";

/**
 * The app (first) submenu. Its update item is the one dynamic piece: normally
 * "Check for Updates…"; once an update is downloaded it becomes
 * "Restart to Update" (VS Code pattern). `setUpdateReadyInMenu` rebuilds the
 * whole menu — `setApplicationMenu` is idempotent and can be re-called anytime.
 */
function _appSubmenu(updateReady: boolean): ApplicationMenuItemConfig {
  const updateItem = updateReady
    ? { label: "Restart to Update", action: "restartToUpdate" }
    : { label: "Check for Updates...", action: "updates.check" };
  return {
    submenu: [
      { label: "About LLM Space", role: "about" },
      updateItem,
      { type: "divider" },
      {
        label: "Settings...",
        action: "settings",
        accelerator: "CommandOrControl+,",
      },
      { type: "divider" },
      { role: "hide", accelerator: "CommandOrControl+H" },
      { role: "hideOthers", accelerator: "CommandOrControl+Shift+H" },
      { role: "showAll" },
      { type: "divider" },
      {
        label: "Quit LLM Space",
        role: "quit",
        accelerator: "CommandOrControl+Q",
      },
    ],
  };
}

function _buildMenu(updateReady: boolean): ApplicationMenuItemConfig[] {
  return [
    _appSubmenu(updateReady),
    {
      label: "File",
      submenu: [
        {
          label: "Open Agent Project...",
          action: "agentProjects.open",
          accelerator: "CommandOrControl+O",
        },
        { type: "divider" },
        {
          label: "New File",
          action: "newThread",
          accelerator: "CommandOrControl+N",
        },
        { label: "New from Examples...", action: "newFromExamples" },
        { type: "divider" },
        {
          label: "New Folder",
          action: "workspace.newFolder",
          accelerator: "CommandOrControl+Shift+N",
        },
        { type: "divider" },
        { label: "Import from Files...", action: "workspace.importFiles" },
        { label: "Import from Clipboard", action: "workspace.importFromClipboard" },
        { type: "divider" },
        { label: "Share...", action: "thread.share" },
        { type: "divider" },
        { label: "Refresh Workspace", action: "workspace.refresh" },
        { label: "Reveal Workspace Folder", action: "revealWorkspaceFolder" },
        { type: "divider" },
        {
          label: "Close Tab",
          action: "tabs.close",
          accelerator: "CommandOrControl+W",
        },
        { label: "Close Others", action: "tabs.closeOthers" },
        { label: "Close All Tabs", action: "tabs.closeAll" },
        { type: "divider" },
        {
          label: "Reopen Closed Tabs",
          action: "reopenClosedTabs",
          accelerator: "CommandOrControl+Shift+T",
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "divider" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Command Palette...",
          action: "commandPalette",
          accelerator: "CommandOrControl+Shift+P",
        },
        { type: "divider" },
        {
          label: "Toggle Sidebar",
          action: "layout.toggleSidebar",
          accelerator: "CommandOrControl+B",
        },
        { type: "divider" },
        {
          label: "Reload",
          action: "window.reload",
          accelerator: "CommandOrControl+Shift+R",
        },
        { type: "divider" },
        {
          label: "Zoom In",
          action: "window.zoomIn",
          accelerator: "CommandOrControl+Plus",
        },
        {
          label: "Zoom Out",
          action: "window.zoomOut",
          accelerator: "CommandOrControl+-",
        },
        {
          label: "Reset Zoom",
          action: "window.resetZoom",
          accelerator: "CommandOrControl+0",
        },
      ],
    },
    {
      label: "Window",
      role: "window",
      submenu: [
        { role: "minimize" },
        { role: "bringAllToFront" },
        { type: "divider" },
        {
          label: "Select Previous Tab",
          action: "tabs.selectPrevious",
          accelerator: "CommandOrControl+Option+Left",
        },
        {
          label: "Select Next Tab",
          action: "tabs.selectNext",
          accelerator: "CommandOrControl+Option+Right",
        },
        { type: "divider" },
        { role: "toggleFullScreen", accelerator: "CommandOrControl+Shift+F" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "View Documentation", action: "shell.openDocument" },
        { type: "divider" },
        { label: "Visit Official Website", action: "openOfficialWebsite" },
        { label: "Visit GitHub Project", action: "openGitHubProject" },
        { label: "Visit Agent 101", action: "openAgent101" },
        { type: "divider" },
        { label: "Report Bug", action: "shell.reportBugs" },
        { label: "Donate", action: "donate" },
        { type: "divider" },
        { label: "Onboard", action: "onboard" },
      ],
    },
  ];
}

/**
 * Flip the app menu's update item between "Check for Updates…" and
 * "Restart to Update". Called by the updater service when a download becomes
 * ready. `null` restores the default item.
 */
export function setUpdateReadyInMenu(version: string | null) {
  ApplicationMenu.setApplicationMenu(_buildMenu(version !== null));
}

/**
 * The native menu items carry a string `action`; map each to the {@link Command}
 * it dispatches. Everything then flows through the window command bus
 * entry point (window-side commands run locally, webview-side ones are
 * forwarded over RPC).
 */
const MENU_ACTION_COMMANDS: Record<string, Command> = {
  openAgentProject: { type: "agentProjects.open", args: {} },
  reload: { type: "window.reload", args: {} },
  zoomIn: { type: "window.zoomIn", args: {} },
  zoomOut: { type: "window.zoomOut", args: {} },
  resetZoom: { type: "window.resetZoom", args: {} },
  toggleSidebar: { type: "layout.toggleSidebar", args: {} },
  commandPalette: { type: "app.openCommandPalette", args: {} },
  settings: { type: "app.openSettings", args: {} },
  newThread: { type: "workspace.newFile", args: {} },
  newFromExamples: { type: "workspace.openStartFromExample", args: { parent: "" } },
  newFolder: { type: "workspace.newFolder", args: {} },
  importFiles: { type: "workspace.importFiles", args: {} },
  importFromClipboard: { type: "workspace.importFromClipboard", args: {} },
  shareThread: { type: "thread.share", args: {} },
  refreshTree: { type: "workspace.refresh", args: {} },
  revealWorkspaceFolder: { type: "shell.openWorkspaceFolder", args: {} },
  closeTab: { type: "tabs.close", args: {} },
  closeOtherTabs: { type: "tabs.closeOthers", args: {} },
  closeAllTabs: { type: "tabs.closeAll", args: {} },
  reopenClosedTabs: { type: "tabs.reopenClosed", args: {} },
  selectNextTab: { type: "tabs.selectNext", args: {} },
  selectPreviousTab: { type: "tabs.selectPrevious", args: {} },
  openDocument: { type: "shell.openDocument", args: {} },
  openGitHubProject: {
    type: "shell.openLink",
    args: { url: "https://github.com/deer-flow/llm-space/tree/main" },
  },
  openOfficialWebsite: {
    type: "shell.openLink",
    args: { url: "https://deer-flow.github.io/llm-space/" },
  },
  reportBugs: { type: "shell.reportBugs", args: {} },
  checkForUpdates: { type: "updates.check", args: {} },
  restartToUpdate: { type: "updates.applyAndRestart", args: {} },
  donate: {
    type: "shell.openLink",
    args: { url: "https://my.feishu.cn/wiki/OvLBwVuSkiCR1ik5wGEcBXZfnye" },
  },
  onboard: { type: "app.openOnboard", args: {} },
  openAgent101: {
    type: "shell.openLink",
    args: {
      url: isChineseLocale()
        ? "https://my.feishu.cn/wiki/L082wubkdie8uMkRUjgceKYQnIe?fromScene=spaceOverview"
        : "https://my.feishu.cn/docx/G8CGdg2PQoGjsRxspKAc9XZYnKT",
    },
  },
};

/**
 * Install the process-wide application menu. Electrobun includes the focused
 * native window id, so commands continue to target Project Studio after Main
 * is closed and later recreated.
 */
export function registerMenuActions(
  getFallbackWindow: () => BrowserWindow | undefined,
  executeCommand: (command: Command, window: BrowserWindow) => void
) {
  ApplicationMenu.setApplicationMenu(_buildMenu(false));
  ApplicationMenu.on("application-menu-clicked", (event) => {
    const { action, id } = (event as { data: { action: string; id?: number } })
      .data;
    const command = MENU_ACTION_COMMANDS[action];
    const target =
      (id === undefined ? undefined : BrowserWindow.getById(id)) ??
      getFallbackWindow();
    if (command && target) executeCommand(command, target);
  });
}
