/**
 * The unified command layer. Every user action that is dispatched across
 * components or across the bun/webview boundary (menus, context menus, toolbar
 * buttons, keyboard shortcuts) is modelled as a {@link Command}: a `type`
 * discriminant plus strongly-typed `args`. A single `executeCommand(command)`
 * on each side routes it to the right handler, replacing the previous
 * one-RPC-method-per-action sprawl.
 */

import type { RuntimeId } from "./runtime";

/** Command identity always includes its owning business namespace. */
export type NamespacedCommandType = `${string}.${string}`;

/** Base shape for every command: a namespaced `type` and typed `args`. */
export interface GenericCommand<
  T extends NamespacedCommandType,
  A = Record<string, never>,
> {
  type: T;
  args: A;
}

// --- File tree -------------------------------------------------------------

/**
 * Create a new thread file. `parent` defaults to the workspace root. When
 * `rename` is true the tree starts an in-place rename on the new file (used by
 * the tree/root "New file" icons); otherwise it is auto-named and opened
 * immediately (used by the ⌘N menu, the tab-bar "+", and the welcome screen).
 */
export interface NewFileCommand extends GenericCommand<
  "workspace.newFile",
  { parent?: string; rename?: boolean; runtimeId?: RuntimeId }
> {}

/**
 * Create a new thread from a built-in prompt example. The command carries only
 * the example's `id`; the file-tree handler resolves the full definition (system
 * prompt, seed tools, seed messages) from the example catalog via
 * `getPromptExample`. `parent` defaults to the workspace root.
 */
export interface NewFileFromPromptExampleCommand extends GenericCommand<
  "workspace.newFileFromPromptExample",
  { parent?: string; exampleId: string; runtimeId?: RuntimeId }
> {}

/**
 * Open the "Start from Example" dialog. `parent` (default: workspace root) is
 * where the chosen example's thread will be created.
 */
export interface OpenStartFromExampleCommand extends GenericCommand<
  "workspace.openStartFromExample",
  { parent?: string; runtimeId?: RuntimeId }
> {}

/** Create a new folder (with in-place rename). `parent` defaults to the root. */
export interface NewFolderCommand extends GenericCommand<
  "workspace.newFolder",
  { parent?: string; runtimeId?: RuntimeId }
> {}

/** Start an in-place rename of the node at `path`. */
export interface RenameFileCommand extends GenericCommand<
  "workspace.rename",
  { path: string; runtimeId?: RuntimeId }
> {}

/** Duplicate the node at `path`. */
export interface DuplicateFileCommand extends GenericCommand<
  "workspace.duplicate",
  { path: string; runtimeId?: RuntimeId }
> {}

/** Move the node at `path` to the OS trash (via a confirm dialog). */
export interface DeleteFileCommand extends GenericCommand<
  "workspace.delete",
  { path: string; runtimeId?: RuntimeId }
> {}

/** Reveal the node at `path` in the OS file manager (`""` = the root). */
export interface RevealFileCommand extends GenericCommand<
  "workspace.reveal",
  { path: string; runtimeId?: RuntimeId }
> {}

/**
 * Copy the file at the **absolute** `path` to the OS clipboard as a file
 * reference, so it can be pasted into Finder/Explorer or other apps. Runs in the
 * bun process (native clipboard). macOS/Windows only.
 */
export interface CopyFileCommand extends GenericCommand<
  "workspace.copyFile",
  { path: string; runtimeId?: RuntimeId }
> {}

/** Refresh (re-list) the file tree. */
export interface RefreshTreeCommand extends GenericCommand<
  "workspace.refresh",
  { runtimeId?: RuntimeId }
> {}

/**
 * Reveal a workspace file in the tree: expand its ancestor folders, refresh the
 * listing, then select, open, and scroll to it once it appears (e.g. after a
 * deep-link import writes into `shared/`).
 */
export interface RevealInTreeCommand extends GenericCommand<
  "workspace.revealInTree",
  { path: string; runtimeId?: RuntimeId }
> {}

export interface ImportFilePayload {
  name: string;
  text: string;
}

/**
 * Import one or more external files (OpenAI / Anthropic / native thread JSON)
 * into the workspace as new thread files. When `files` is absent the renderer
 * opens its hidden picker; native menu actions fill `files` from the OS dialog.
 */
export interface ImportFilesCommand extends GenericCommand<
  "workspace.importFiles",
  { parent?: string; files?: ImportFilePayload[]; runtimeId?: RuntimeId }
> {}

/**
 * Import a thread from the OS clipboard's text content. The bun process reads
 * the native clipboard, then forwards a virtual JSON file to the renderer so
 * parsing/writing stays shared with file imports.
 */
export interface ImportFromClipboardCommand extends GenericCommand<
  "workspace.importFromClipboard",
  { parent?: string; runtimeId?: RuntimeId }
> {}

// --- Tabs ------------------------------------------------------------------

/**
 * Close a tab. `id` is the app-tab id;
 * `path` is kept for legacy thread callers; omitting both closes the active tab.
 */
export interface CloseTabCommand extends GenericCommand<
  "tabs.close",
  { id?: string; path?: string; runtimeId?: RuntimeId }
> {}

/**
 * Close every tab except the target. Prefer `id`; `path` is a legacy thread
 * path; omitting both keeps the active tab.
 */
export interface CloseOtherTabsCommand extends GenericCommand<
  "tabs.closeOthers",
  { id?: string; path?: string; runtimeId?: RuntimeId }
> {}

/** Close every open tab. */
export interface CloseAllTabsCommand extends GenericCommand<"tabs.closeAll"> {}

/** Reopen the most recently closed tab group. */
export interface ReopenClosedTabCommand extends GenericCommand<"tabs.reopenClosed"> {}

/** Activate the tab after the active one in visual order, wrapping around. */
export interface SelectNextTabCommand extends GenericCommand<"tabs.selectNext"> {}

/** Activate the tab before the active one in visual order, wrapping around. */
export interface SelectPreviousTabCommand extends GenericCommand<"tabs.selectPrevious"> {}

// --- View / app ------------------------------------------------------------

/** Collapse or expand the left side panel. */
export interface ToggleSidebarCommand extends GenericCommand<"layout.toggleSidebar"> {}

/** Which Settings tab to show. */
export type SettingsTab =
  | "account"
  | "general"
  | "models"
  | "mcp"
  | "network"
  | "search"
  | "skills"
  | "experimental";

/** Open the Settings dialog, optionally on a specific `tab`. */
export interface OpenSettingsCommand extends GenericCommand<
  "app.openSettings",
  { tab?: SettingsTab }
> {}

/** Open the Settings dialog directly on the Models tab. */
export interface OpenModelSettingsCommand extends GenericCommand<"app.openModelSettings"> {}

/** Open the command palette. */
export interface OpenCommandPaletteCommand extends GenericCommand<"app.openCommandPalette"> {}

/** Open the first-run onboarding dialog. */
export interface OpenOnboardCommand extends GenericCommand<"app.openOnboard"> {}

/** Run the active thread. No-op when there is no active thread tab. */
export interface RunThreadCommand extends GenericCommand<"thread.run"> {}

/** Create a new Studio Thread in the active Agent Project window. */
export interface CreateProjectThreadCommand extends GenericCommand<"project.createThread"> {}

/** Fork a Studio Thread onto the Agent Project's current Git HEAD. */
export interface ForkProjectThreadCommand extends GenericCommand<
  "project.forkThread",
  { threadId: string; checkpointId?: string }
> {}

/**
 * Open the Share dialog for a thread. `path` + `runtimeId` target a specific
 * thread file (tree/tab context menus and playground header); omitting them
 * shares the active thread (native menu and command palette). No-op when there
 * is no active thread tab. Webview only.
 */
export interface ShareThreadCommand extends GenericCommand<
  "thread.share",
  { path?: string; runtimeId?: RuntimeId }
> {}

/**
 * Open the Variables dialog for the active thread. When `variableName` is given,
 * the dialog opens focused on that variable; otherwise it opens at the default
 * selection. Webview only, and intentionally excluded from the command palette.
 */
export interface OpenVariablesCommand extends GenericCommand<
  "thread.openVariables",
  { variableName?: string }
> {}

// --- Window (bun-side) -----------------------------------------------------

/** Zoom the page in one step. */
export interface ZoomInCommand extends GenericCommand<"window.zoomIn"> {}
/** Zoom the page out one step. */
export interface ZoomOutCommand extends GenericCommand<"window.zoomOut"> {}
/** Reset the page zoom to 100%. */
export interface ResetZoomCommand extends GenericCommand<"window.resetZoom"> {}
/** Reload the webview. */
export interface ReloadCommand extends GenericCommand<"window.reload"> {}

/** Open a URL in the user's default browser (via the OS). */
export interface OpenLinkCommand extends GenericCommand<
  "shell.openLink",
  { url: string }
> {}

/**
 * Open the documentation website in the user's default browser. `path` may point
 * at a specific doc page (currently ignored — always opens the docs home).
 */
export interface OpenDocumentCommand extends GenericCommand<
  "shell.openDocument",
  { path?: string; runtimeId?: RuntimeId }
> {}

/** Open the GitHub issues page in the user's default browser to report a bug. */
export interface ReportBugsCommand extends GenericCommand<"shell.reportBugs"> {}

/** Open the workspace folder (`LLM_SPACE_HOME/workspace`) in the OS file manager. */
export interface OpenWorkspaceFolderCommand extends GenericCommand<"shell.openWorkspaceFolder"> {}

/** Pick and open a code-first Agent project in its own desktop window. */
export interface OpenAgentProjectCommand extends GenericCommand<"agentProjects.open"> {}

// --- GitHub auth (bun-side) ------------------------------------------------

/**
 * Start the GitHub OAuth Device Flow: the bun side requests a code, opens the
 * verification window, and polls for the token. Modelled as a command so any
 * surface (Account page, a future "sign in to share" prompt) can trigger it.
 */
export interface GithubLoginCommand extends GenericCommand<"githubAccount.login"> {}

/** Sign out of GitHub: forget the stored token. */
export interface GithubLogoutCommand extends GenericCommand<"githubAccount.logout"> {}

// --- Updates ---------------------------------------------------------------

/**
 * Manually check for an app update (and download it when one is found). The
 * bun-side updater reports progress back over the `updateStatusChanged` RPC
 * message; see `shared/updates.ts`.
 */
export interface CheckForUpdatesCommand extends GenericCommand<"updates.check"> {}

/** Apply a downloaded update: quit, swap the app bundle, relaunch. */
export interface ApplyUpdateAndRestartCommand extends GenericCommand<"updates.applyAndRestart"> {}

/** The discriminated union of every command. */
export type Command =
  | NewFileCommand
  | NewFileFromPromptExampleCommand
  | OpenStartFromExampleCommand
  | NewFolderCommand
  | RenameFileCommand
  | DuplicateFileCommand
  | DeleteFileCommand
  | RevealFileCommand
  | CopyFileCommand
  | RefreshTreeCommand
  | RevealInTreeCommand
  | ImportFilesCommand
  | ImportFromClipboardCommand
  | CloseTabCommand
  | CloseOtherTabsCommand
  | CloseAllTabsCommand
  | ReopenClosedTabCommand
  | SelectNextTabCommand
  | SelectPreviousTabCommand
  | ToggleSidebarCommand
  | OpenSettingsCommand
  | OpenModelSettingsCommand
  | OpenCommandPaletteCommand
  | OpenOnboardCommand
  | RunThreadCommand
  | CreateProjectThreadCommand
  | ForkProjectThreadCommand
  | ShareThreadCommand
  | OpenVariablesCommand
  | ZoomInCommand
  | ZoomOutCommand
  | ResetZoomCommand
  | ReloadCommand
  | OpenLinkCommand
  | OpenDocumentCommand
  | ReportBugsCommand
  | OpenWorkspaceFolderCommand
  | OpenAgentProjectCommand
  | GithubLoginCommand
  | GithubLogoutCommand
  | CheckForUpdatesCommand
  | ApplyUpdateAndRestartCommand;

/** The `type` string of any command. */
export type CommandType = Command["type"];

/** The `args` type for a specific command `type`. */
export type CommandArgs<T extends CommandType> = Extract<
  Command,
  { type: T }
>["args"];

/**
 * Where a command executes: `"webview"` commands run in the renderer (tab /
 * tree / sidebar state); `"bun"` commands run in the main process (window
 * zoom / reload). `label` is the human-facing name in Title Case (e.g. for a
 * command palette or context menu), matching dropdown/context/native menus.
 */
export const COMMAND_META: Record<
  CommandType,
  { label: string; target: "webview" | "bun" }
> = {
  "workspace.newFile": { label: "New File", target: "webview" },
  "workspace.newFileFromPromptExample": {
    label: "Start from Example",
    target: "webview",
  },
  "workspace.openStartFromExample": {
    label: "New from Examples...",
    target: "webview",
  },
  "workspace.newFolder": { label: "New Folder", target: "webview" },
  "workspace.rename": { label: "Rename", target: "webview" },
  "workspace.duplicate": { label: "Duplicate", target: "webview" },
  "workspace.delete": { label: "Move to Trash", target: "webview" },
  "workspace.reveal": { label: "Reveal in Finder", target: "webview" },
  "workspace.copyFile": { label: "Copy", target: "bun" },
  "workspace.refresh": { label: "Refresh", target: "webview" },
  "workspace.revealInTree": { label: "Reveal in Tree", target: "webview" },
  "workspace.importFiles": { label: "Import from Files...", target: "webview" },
  "workspace.importFromClipboard": {
    label: "Import from Clipboard",
    target: "bun",
  },
  "tabs.close": { label: "Close Tab", target: "webview" },
  "tabs.closeOthers": { label: "Close Other Tabs", target: "webview" },
  "tabs.closeAll": { label: "Close All Tabs", target: "webview" },
  "tabs.reopenClosed": { label: "Reopen Closed Tab", target: "webview" },
  "tabs.selectNext": { label: "Select Next Tab", target: "webview" },
  "tabs.selectPrevious": { label: "Select Previous Tab", target: "webview" },
  "layout.toggleSidebar": { label: "Toggle Sidebar", target: "webview" },
  "app.openSettings": { label: "Settings", target: "webview" },
  "app.openModelSettings": {
    label: "Configure Model Settings",
    target: "webview",
  },
  "app.openCommandPalette": { label: "Command Palette", target: "webview" },
  "app.openOnboard": { label: "Onboard...", target: "webview" },
  "thread.run": { label: "Run Thread", target: "webview" },
  "project.createThread": { label: "New Project Thread", target: "webview" },
  "project.forkThread": { label: "Fork Thread", target: "webview" },
  "thread.share": { label: "Share...", target: "webview" },
  "thread.openVariables": { label: "Variables", target: "webview" },
  "window.zoomIn": { label: "Zoom In", target: "bun" },
  "window.zoomOut": { label: "Zoom Out", target: "bun" },
  "window.resetZoom": { label: "Reset Zoom", target: "bun" },
  "window.reload": { label: "Reload", target: "bun" },
  "shell.openLink": { label: "Open Link", target: "bun" },
  "shell.openDocument": { label: "Documents", target: "bun" },
  "shell.reportBugs": { label: "Report Bug", target: "bun" },
  "shell.openWorkspaceFolder": {
    label: "Open Workspace Folder",
    target: "bun",
  },
  "agentProjects.open": { label: "Open Agent Project...", target: "bun" },
  "githubAccount.login": { label: "Sign in with GitHub", target: "bun" },
  "githubAccount.logout": { label: "Sign out of GitHub", target: "bun" },
  "updates.check": { label: "Check for Updates...", target: "bun" },
  "updates.applyAndRestart": { label: "Restart to Update", target: "bun" },
};
