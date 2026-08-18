/**
 * The unified command layer. Every user action that is dispatched across
 * components or across the bun/webview boundary (menus, context menus, toolbar
 * buttons, keyboard shortcuts) is modelled as a {@link Command}: a `type`
 * discriminant plus strongly-typed `args`. A single `executeCommand(command)`
 * on each side routes it to the right handler, replacing the previous
 * one-RPC-method-per-action sprawl.
 */

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

// --- Playground ------------------------------------------------------------

/**
 * Create and open a durable Playground.
 */
export interface CreatePlaygroundCommand extends GenericCommand<"playground.create"> {}

/**
 * Create a new thread from a built-in prompt example. The command carries only
 * the example's `id`; the Playground handler resolves the full definition
 * (system prompt, seed tools, seed messages) from the example catalog.
 */
export interface CreatePlaygroundFromExampleCommand extends GenericCommand<
  "playground.createFromExample",
  { exampleId: string }
> {}

/**
 * Open the "Start from Example" dialog.
 */
export interface OpenPlaygroundExamplesCommand extends GenericCommand<
  "playground.openExamples"
> {}

export interface ImportFilePayload {
  name: string;
  text: string;
}

/**
 * Import ACP Shared Document files as new durable Playgrounds. When `files`
 * is absent the renderer opens its hidden picker; native menu actions fill
 * `files` from the OS dialog.
 */
export interface ImportFilesCommand extends GenericCommand<
  "playground.importFiles",
  { files?: ImportFilePayload[] }
> {}

/**
 * Import a thread from the OS clipboard's text content. The bun process reads
 * the native clipboard, then forwards a virtual JSON file to the renderer so
 * parsing/writing stays shared with file imports.
 */
export interface ImportFromClipboardCommand extends GenericCommand<"playground.importFromClipboard"> {}

// --- Tabs ------------------------------------------------------------------

/**
 * Close a tab. Omitting `id` closes the active tab.
 */
export interface CloseTabCommand extends GenericCommand<
  "tabs.close",
  { id?: string }
> {}

/**
 * Close every tab except the target. Omitting `id` keeps the active tab.
 */
export interface CloseOtherTabsCommand extends GenericCommand<
  "tabs.closeOthers",
  { id?: string }
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
 * Open the Share dialog for a Playground. `path` targets a specific Playground
 * projection; omitting it
 * shares the active thread (native menu and command palette). No-op when there
 * is no active thread tab. Webview only.
 */
export interface ShareThreadCommand extends GenericCommand<
  "thread.share",
  { path?: string }
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

/** Toggle the owning native window between maximized and restored. */
export interface ToggleMaximizedCommand extends GenericCommand<"window.toggleMaximized"> {}
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
  { path?: string }
> {}

/** Open the GitHub issues page in the user's default browser to report a bug. */
export interface ReportBugsCommand extends GenericCommand<"shell.reportBugs"> {}

/** Open a known Agent Project root, or show the native picker when omitted. */
export interface OpenAgentProjectCommand extends GenericCommand<
  "agentProjects.open",
  { rootPath?: string }
> {}

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
  | CreatePlaygroundCommand
  | CreatePlaygroundFromExampleCommand
  | OpenPlaygroundExamplesCommand
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
  | ToggleMaximizedCommand
  | ZoomInCommand
  | ZoomOutCommand
  | ResetZoomCommand
  | ReloadCommand
  | OpenLinkCommand
  | OpenDocumentCommand
  | ReportBugsCommand
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
  "playground.create": { label: "New Playground", target: "webview" },
  "playground.createFromExample": {
    label: "Start from Example",
    target: "webview",
  },
  "playground.openExamples": {
    label: "New from Examples...",
    target: "webview",
  },
  "playground.importFiles": { label: "Import from Files...", target: "webview" },
  "playground.importFromClipboard": {
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
  "window.toggleMaximized": { label: "Toggle Maximized", target: "bun" },
  "window.zoomIn": { label: "Zoom In", target: "bun" },
  "window.zoomOut": { label: "Zoom Out", target: "bun" },
  "window.resetZoom": { label: "Reset Zoom", target: "bun" },
  "window.reload": { label: "Reload", target: "bun" },
  "shell.openLink": { label: "Open Link", target: "bun" },
  "shell.openDocument": { label: "Documents", target: "bun" },
  "shell.reportBugs": { label: "Report Bug", target: "bun" },
  "agentProjects.open": { label: "Open Agent Project...", target: "bun" },
  "githubAccount.login": { label: "Sign in with GitHub", target: "bun" },
  "githubAccount.logout": { label: "Sign out of GitHub", target: "bun" },
  "updates.check": { label: "Check for Updates...", target: "bun" },
  "updates.applyAndRestart": { label: "Restart to Update", target: "bun" },
};
