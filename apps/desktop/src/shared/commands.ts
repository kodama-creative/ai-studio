/**
 * The unified command layer. Every user action that is dispatched across
 * components or across the bun/webview boundary (menus, context menus, toolbar
 * buttons, keyboard shortcuts) is modelled as a {@link Command}: a `type`
 * discriminant plus strongly-typed `args`. A single `executeCommand(command)`
 * on each side routes it to the right handler, replacing the previous
 * one-RPC-method-per-action sprawl.
 */

import type { TraceConnectedProjectInput, TraceImportFile } from "./traces";

/** Base shape for every command: a string `type` and typed `args`. */
export interface GenericCommand<T extends string, A = Record<string, never>> {
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
  "newFile",
  { parent?: string; rename?: boolean; }
> {}

/**
 * Create a new thread from a built-in prompt example. The command carries only
 * the example's `id`; the file-tree handler resolves the full definition (system
 * prompt, seed tools, seed messages) from the example catalog via
 * `getPromptExample`. `parent` defaults to the workspace root.
 */
export interface NewFileFromPromptExampleCommand extends GenericCommand<
  "newFileFromPromptExample",
  { exampleId: string; parent?: string; }
> {}

/**
 * Open the "Start from Example" dialog. `parent` (default: workspace root) is
 * where the chosen example's thread will be created.
 */
export interface OpenStartFromExampleCommand extends GenericCommand<
  "openStartFromExample",
  { parent?: string; }
> {}

/** Choose, validate, trust, and open an external Agent Project directory. */
export interface OpenExternalAgentProjectCommand extends GenericCommand<"openExternalAgentProject"> {}

/** Trust a previously previewed Agent Project path and open it in Desktop. */
export interface TrustExternalAgentProjectCommand extends GenericCommand<
  "trustExternalAgentProject",
  { path: string; }
> {}

/** Create a desktop-owned Thread for an imported Agent Project. */
export interface CreateExternalAgentProjectThreadCommand extends GenericCommand<
  "createExternalAgentProjectThread",
  {
    projectId: string;
    runtimeProfileType?: "desktopDirect" | "localServer";
  }
> {}

/** Reload one imported Agent Project from its watched source directory. */
export interface RefreshExternalAgentProjectCommand extends GenericCommand<
  "refreshExternalAgentProject",
  { projectId: string; }
> {}

/** Reveal an imported Agent Project directory in the OS file manager. */
export interface RevealExternalAgentProjectCommand extends GenericCommand<
  "revealExternalAgentProject",
  { path: string; }
> {}

/** Remove an imported Agent Project from Desktop without changing its source. */
export interface RemoveExternalAgentProjectCommand extends GenericCommand<
  "removeExternalAgentProject",
  { projectId: string; }
> {}

/** Rename a desktop-owned Agent Project Thread. */
export interface RenameExternalAgentProjectThreadCommand extends GenericCommand<
  "renameExternalAgentProjectThread",
  { projectId: string; threadId: string; title: string; }
> {}

/** Duplicate a desktop-owned Agent Project Thread. */
export interface DuplicateExternalAgentProjectThreadCommand extends GenericCommand<
  "duplicateExternalAgentProjectThread",
  { projectId: string; threadId: string; }
> {}

/** Delete a desktop-owned Agent Project Thread after confirmation. */
export interface DeleteExternalAgentProjectThreadCommand extends GenericCommand<
  "deleteExternalAgentProjectThread",
  { projectId: string; threadId: string; }
> {}

/** Replace one Thread's local definition fields with the latest Agent values. */
export interface SyncExternalAgentProjectThreadFromAgentCommand extends GenericCommand<
  "syncExternalAgentProjectThreadFromAgent",
  { projectId: string; threadId: string; }
> {}

/** Reconnect one active Project Thread's source-declared MCP connections. */
export interface RetryExternalAgentProjectConnectionsCommand extends GenericCommand<
  "retryExternalAgentProjectConnections",
  { projectId: string; threadId: string; }
> {}

/** Recheck one Local Server Thread's Bun-owned runtime availability. */
export interface RetryExternalAgentProjectRuntimeCommand extends GenericCommand<
  "retryExternalAgentProjectRuntime",
  { projectId: string; threadId: string; }
> {}

/** Open the Build tab and focus the source that owns a project action. */
export interface OpenExternalAgentProjectSourceCommand extends GenericCommand<
  "openExternalAgentProjectSource",
  {
    projectId: string;
    projectName: string;
    projectPath: string;
    sourcePath: string;
  }
> {}

/** Save an Agent Project source file through the trusted Bun-side boundary. */
export interface SaveExternalAgentProjectSourceCommand extends GenericCommand<
  "saveExternalAgentProjectSource",
  { overwrite?: boolean; path: string; projectId: string; text: string; }
> {}

/** Create a new folder (with in-place rename). `parent` defaults to the root. */
export interface NewFolderCommand extends GenericCommand<
  "newFolder",
  { parent?: string; }
> {}

/** Start an in-place rename of the node at `path`. */
export interface RenameFileCommand extends GenericCommand<
  "renameFile",
  { path: string; }
> {}

/** Duplicate the node at `path`. */
export interface DuplicateFileCommand extends GenericCommand<
  "duplicateFile",
  { path: string; }
> {}

/** Move the node at `path` to the OS trash (via a confirm dialog). */
export interface DeleteFileCommand extends GenericCommand<
  "deleteFile",
  { path: string; }
> {}

/** Reveal the node at `path` in the OS file manager (`""` = the root). */
export interface RevealFileCommand extends GenericCommand<
  "revealFile",
  { path: string; }
> {}

/**
 * Copy the file at the **absolute** `path` to the OS clipboard as a file
 * reference, so it can be pasted into Finder/Explorer or other apps. Runs in the
 * bun process (native clipboard). macOS/Windows only.
 */
export interface CopyFileCommand extends GenericCommand<
  "copyFile",
  { path: string; }
> {}

/** Refresh (re-list) the file tree. */
export interface RefreshTreeCommand extends GenericCommand<"refreshTree"> {}

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
  "importFiles",
  { files?: ImportFilePayload[]; parent?: string; }
> {}

/**
 * Import a thread from the OS clipboard's text content. The bun process reads
 * the native clipboard, then forwards a virtual JSON file to the renderer so
 * parsing/writing stays shared with file imports.
 */
export interface ImportFromClipboardCommand extends GenericCommand<
  "importFromClipboard",
  { parent?: string; }
> {}

// --- Traces ----------------------------------------------------------------

/**
 * Create a trace project in `LLM_SPACE_HOME/traces`. The caller supplies a
 * non-empty display `name`; the trace panel handler selects the created project
 * and refreshes the trace-project list.
 */
export interface CreateTraceProjectCommand extends GenericCommand<
  "createTraceProject",
  { name: string; }
> {}

/**
 * Create a connected Langfuse trace project after testing credentials. The full
 * secret is carried only to the Bun process; renderer feedback must be redacted.
 */
export interface CreateConnectedTraceProjectCommand extends GenericCommand<
  "createConnectedTraceProject",
  TraceConnectedProjectInput
> {}

/**
 * Import Langfuse observation export files into one trace project. `files` are
 * already read by the renderer picker; the bun-side trace manager writes
 * `raw.json` / `trace.json` and reports skipped files plus source warnings.
 */
export interface ImportLangfuseTraceFilesCommand extends GenericCommand<
  "importLangfuseTraceFiles",
  { files: TraceImportFile[]; projectId: string; }
> {}

/** Sync selected remote Langfuse trace ids into a connected trace project. */
export interface SyncLangfuseTraceIdsCommand extends GenericCommand<
  "syncLangfuseTraceIds",
  { projectId: string; traceIds: string[]; }
> {}

// --- Tabs ------------------------------------------------------------------

/**
 * Close a tab. `id` is the app-tab id (`thread:{path}` or `trace:{project}:{key}`);
 * `path` is kept for legacy thread callers; omitting both closes the active tab.
 */
export interface CloseTabCommand extends GenericCommand<
  "closeTab",
  { id?: string; path?: string; }
> {}

/**
 * Close every tab except the target. Prefer `id`; `path` is a legacy thread
 * path; omitting both keeps the active tab.
 */
export interface CloseOtherTabsCommand extends GenericCommand<
  "closeOtherTabs",
  { id?: string; path?: string; }
> {}

/** Close every open tab. */
export interface CloseAllTabsCommand extends GenericCommand<"closeAllTabs"> {}

/** Reopen the most recently closed tab group. */
export interface ReopenClosedTabCommand extends GenericCommand<"reopenClosedTab"> {}

/** Activate the tab after the active one in visual order, wrapping around. */
export interface SelectNextTabCommand extends GenericCommand<"selectNextTab"> {}

/** Activate the tab before the active one in visual order, wrapping around. */
export interface SelectPreviousTabCommand extends GenericCommand<"selectPreviousTab"> {}

// --- View / app ------------------------------------------------------------

/** Collapse or expand the left side panel. */
export interface ToggleSidebarCommand extends GenericCommand<"toggleSidebar"> {}

/** Which Settings tab to show. */
export type SettingsTab =
  "experimental" | "general" | "mcp" | "models" | "search" | "skills";

/** Open the Settings dialog, optionally on a specific `tab`. */
export interface OpenSettingsCommand extends GenericCommand<
  "openSettings",
  { tab?: SettingsTab; }
> {}

/** Open the Settings dialog directly on the Models tab. */
export interface OpenModelSettingsCommand extends GenericCommand<"openModelSettings"> {}

/** Open the command palette. */
export interface OpenCommandPaletteCommand extends GenericCommand<"openCommandPalette"> {}

/** Open the first-run onboarding dialog. */
export interface OpenOnboardCommand extends GenericCommand<"openOnboard"> {}

/** Run the active thread. No-op when there is no active thread tab. */
export interface RunThreadCommand extends GenericCommand<"runThread"> {}

/**
 * Open the Variables dialog for the active thread. When `variableName` is given,
 * the dialog opens focused on that variable; otherwise it opens at the default
 * selection. Webview only, and intentionally excluded from the command palette.
 */
export interface OpenVariablesCommand extends GenericCommand<
  "openVariables",
  { variableName?: string; }
> {}

// --- Window (bun-side) -----------------------------------------------------

/** Zoom the page in one step. */
export interface ZoomInCommand extends GenericCommand<"zoomIn"> {}

/** Zoom the page out one step. */
export interface ZoomOutCommand extends GenericCommand<"zoomOut"> {}

/** Reset the page zoom to 100%. */
export interface ResetZoomCommand extends GenericCommand<"resetZoom"> {}

/** Reload the webview. */
export interface ReloadCommand extends GenericCommand<"reload"> {}

/** Open a URL in the user's default browser (via the OS). */
export interface OpenLinkCommand extends GenericCommand<
  "openLink",
  { url: string; }
> {}

/**
 * Open the documentation website in the user's default browser. `path` may point
 * at a specific doc page (currently ignored — always opens the docs home).
 */
export interface OpenDocumentCommand extends GenericCommand<
  "openDocument",
  { path?: string; }
> {}

/** Open the GitHub issues page in the user's default browser to report a bug. */
export interface ReportBugsCommand extends GenericCommand<"reportBugs"> {}

/** Open the workspace folder (`LLM_SPACE_HOME/workspace`) in the OS file manager. */
export interface OpenWorkspaceFolderCommand extends GenericCommand<"openWorkspaceFolder"> {}

// --- Updates ---------------------------------------------------------------

/**
 * Manually check for an app update (and download it when one is found). The
 * bun-side updater reports progress back over the `updateStatusChanged` RPC
 * message; see `shared/updates.ts`.
 */
export interface CheckForUpdatesCommand extends GenericCommand<"checkForUpdates"> {}

/** Apply a downloaded update: quit, swap the app bundle, relaunch. */
export interface ApplyUpdateAndRestartCommand extends GenericCommand<"applyUpdateAndRestart"> {}

/** The discriminated union of every command. */
export type Command =
  | ApplyUpdateAndRestartCommand
  | CheckForUpdatesCommand
  | CloseAllTabsCommand
  | CloseOtherTabsCommand
  | CloseTabCommand
  | CopyFileCommand
  | CreateConnectedTraceProjectCommand
  | CreateExternalAgentProjectThreadCommand
  | CreateTraceProjectCommand
  | DeleteExternalAgentProjectThreadCommand
  | DeleteFileCommand
  | DuplicateExternalAgentProjectThreadCommand
  | DuplicateFileCommand
  | ImportFilesCommand
  | ImportFromClipboardCommand
  | ImportLangfuseTraceFilesCommand
  | NewFileCommand
  | NewFileFromPromptExampleCommand
  | NewFolderCommand
  | OpenCommandPaletteCommand
  | OpenDocumentCommand
  | OpenExternalAgentProjectCommand
  | OpenExternalAgentProjectSourceCommand
  | OpenLinkCommand
  | OpenModelSettingsCommand
  | OpenOnboardCommand
  | OpenSettingsCommand
  | OpenStartFromExampleCommand
  | OpenVariablesCommand
  | OpenWorkspaceFolderCommand
  | RefreshExternalAgentProjectCommand
  | RefreshTreeCommand
  | ReloadCommand
  | RemoveExternalAgentProjectCommand
  | RenameExternalAgentProjectThreadCommand
  | RenameFileCommand
  | ReopenClosedTabCommand
  | ReportBugsCommand
  | ResetZoomCommand
  | RetryExternalAgentProjectConnectionsCommand
  | RetryExternalAgentProjectRuntimeCommand
  | RevealExternalAgentProjectCommand
  | RevealFileCommand
  | RunThreadCommand
  | SaveExternalAgentProjectSourceCommand
  | SelectNextTabCommand
  | SelectPreviousTabCommand
  | SyncExternalAgentProjectThreadFromAgentCommand
  | SyncLangfuseTraceIdsCommand
  | ToggleSidebarCommand
  | TrustExternalAgentProjectCommand
  | ZoomInCommand
  | ZoomOutCommand;

/** The `type` string of any command. */
export type CommandType = Command["type"];

/** The `args` type for a specific command `type`. */
export type CommandArgs<T extends CommandType> = Extract<
  Command,
  { type: T; }
>["args"];

/**
 * Where a command executes: `"webview"` commands run in the renderer (tab /
 * tree / sidebar state); `"bun"` commands run in the main process (window
 * zoom / reload). `label` is the human-facing name in Title Case (e.g. for a
 * command palette or context menu), matching dropdown/context/native menus.
 */
export const COMMAND_META: Record<
  CommandType,
  { label: string; target: "bun" | "webview"; }
> = {
  newFile: { label: "New File", target: "webview" },
  newFileFromPromptExample: {
    label: "Start from Example",
    target: "webview"
  },
  openStartFromExample: {
    label: "New from Examples...",
    target: "webview"
  },
  openExternalAgentProject: {
    label: "Open Agent Project...",
    target: "webview"
  },
  trustExternalAgentProject: {
    label: "Trust and Open Agent Project",
    target: "webview"
  },
  createExternalAgentProjectThread: {
    label: "New Agent Project Thread",
    target: "webview"
  },
  refreshExternalAgentProject: {
    label: "Refresh Agent Project",
    target: "webview"
  },
  revealExternalAgentProject: {
    label: "Reveal Agent Project in Finder",
    target: "webview"
  },
  removeExternalAgentProject: {
    label: "Remove Agent Project from Desktop",
    target: "webview"
  },
  renameExternalAgentProjectThread: {
    label: "Rename Agent Project Thread",
    target: "webview"
  },
  duplicateExternalAgentProjectThread: {
    label: "Duplicate Agent Project Thread",
    target: "webview"
  },
  deleteExternalAgentProjectThread: {
    label: "Delete Agent Project Thread",
    target: "webview"
  },
  syncExternalAgentProjectThreadFromAgent: {
    label: "Sync from Agent",
    target: "webview"
  },
  retryExternalAgentProjectConnections: {
    label: "Retry Agent Project Connections",
    target: "webview"
  },
  retryExternalAgentProjectRuntime: {
    label: "Retry Local Server Runtime",
    target: "webview"
  },
  openExternalAgentProjectSource: {
    label: "Open Agent Project Source",
    target: "webview"
  },
  saveExternalAgentProjectSource: {
    label: "Save Agent Project Source",
    target: "webview"
  },
  newFolder: { label: "New Folder", target: "webview" },
  renameFile: { label: "Rename", target: "webview" },
  duplicateFile: { label: "Duplicate", target: "webview" },
  deleteFile: { label: "Move to Trash", target: "webview" },
  revealFile: { label: "Reveal in Finder", target: "webview" },
  copyFile: { label: "Copy", target: "bun" },
  refreshTree: { label: "Refresh", target: "webview" },
  importFiles: { label: "Import from Files...", target: "webview" },
  importFromClipboard: { label: "Import from Clipboard", target: "bun" },
  createTraceProject: { label: "New Trace Project", target: "webview" },
  createConnectedTraceProject: {
    label: "Connect Langfuse",
    target: "webview"
  },
  importLangfuseTraceFiles: {
    label: "Import Langfuse Export...",
    target: "webview"
  },
  syncLangfuseTraceIds: { label: "Sync Langfuse Traces", target: "webview" },
  closeTab: { label: "Close Tab", target: "webview" },
  closeOtherTabs: { label: "Close Other Tabs", target: "webview" },
  closeAllTabs: { label: "Close All Tabs", target: "webview" },
  reopenClosedTab: { label: "Reopen Closed Tab", target: "webview" },
  selectNextTab: { label: "Select Next Tab", target: "webview" },
  selectPreviousTab: { label: "Select Previous Tab", target: "webview" },
  toggleSidebar: { label: "Toggle Sidebar", target: "webview" },
  openSettings: { label: "Settings", target: "webview" },
  openModelSettings: { label: "Configure Model Settings", target: "webview" },
  openCommandPalette: { label: "Command Palette", target: "webview" },
  openOnboard: { label: "Onboard...", target: "webview" },
  runThread: { label: "Run Thread", target: "webview" },
  openVariables: { label: "Variables", target: "webview" },
  zoomIn: { label: "Zoom In", target: "bun" },
  zoomOut: { label: "Zoom Out", target: "bun" },
  resetZoom: { label: "Reset Zoom", target: "bun" },
  reload: { label: "Reload", target: "bun" },
  openLink: { label: "Open Link", target: "bun" },
  openDocument: { label: "Documents", target: "bun" },
  reportBugs: { label: "Report Bug", target: "bun" },
  openWorkspaceFolder: { label: "Open Workspace Folder", target: "bun" },
  checkForUpdates: { label: "Check for Updates...", target: "bun" },
  applyUpdateAndRestart: { label: "Restart to Update", target: "bun" }
};
