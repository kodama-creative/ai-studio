import { inject, injectable } from "inversify";

import type { RendererLifecycleContribution } from "@/app/di/lifecycle";
import {
  AGENT_PROJECTS_SERVICE,
  type AgentProjectsRequests,
} from "@/shared/agent-project-rpc";
import {
  GITHUB_ACCOUNT_SERVICE,
  type GithubAccountRequests,
} from "@/shared/github-account-rpc";
import {
  NATIVE_DIALOGS_SERVICE,
  type NativeDialogsRequests,
} from "@/shared/native-dialogs-rpc";
import { SHELL_SERVICE, type ShellRequests } from "@/shared/shell-rpc";
import { UPDATES_SERVICE, type UpdatesRequests } from "@/shared/updates-rpc";
import { WINDOW_SERVICE, type WindowRequests } from "@/shared/window-rpc";

import { COMMAND_SERVICE, type CommandService } from "./command-service";

/** Map UI Commands to the typed remote Services that own native side effects. */
@injectable()
export class RemoteCommandContribution
  implements RendererLifecycleContribution
{
  private _disposeHandlers: (() => void) | undefined;

  constructor(
    @inject(COMMAND_SERVICE)
    private readonly _commands: CommandService,
    @inject(WINDOW_SERVICE)
    private readonly _window: WindowRequests,
    @inject(SHELL_SERVICE)
    private readonly _shell: ShellRequests,
    @inject(NATIVE_DIALOGS_SERVICE)
    private readonly _dialogs: NativeDialogsRequests,
    @inject(AGENT_PROJECTS_SERVICE)
    private readonly _projects: AgentProjectsRequests,
    @inject(GITHUB_ACCOUNT_SERVICE)
    private readonly _github: GithubAccountRequests,
    @inject(UPDATES_SERVICE)
    private readonly _updates: UpdatesRequests
  ) {}

  /** Register the fixed native-command set after the Registry starts. */
  start(): void {
    if (this._disposeHandlers !== undefined) return;
    this._disposeHandlers = this._commands.registerCommandHandlers({
      "window.toggleMaximized": () => this._window.toggleMaximized(),
      "window.zoomIn": () => this._window.zoomIn(),
      "window.zoomOut": () => this._window.zoomOut(),
      "window.resetZoom": () => this._window.resetZoom(),
      "window.reload": () => this._window.reload(),
      "shell.openLink": ({ url }) => this._shell.openLink(url),
      "shell.openDocument": ({ path }) => this._shell.openDocument(path),
      "shell.reportBugs": () => this._shell.reportBugs(),
      "agentProjects.open": ({ rootPath }) => this._projects.open(rootPath),
      "githubAccount.login": () => this._github.signIn(),
      "githubAccount.logout": () => this._github.signOut(),
      "updates.check": () => this._updates.check(),
      "updates.applyAndRestart": () => this._updates.applyAndRestart(),
      "playground.importFromClipboard": async () => {
        const files = await this._dialogs.readClipboardImport();
        this._commands.executeCommand({
          type: "playground.importFiles",
          args: { files: [...files] },
        });
      },
    });
  }

  /** Remove exactly the handlers registered by this contribution. */
  stop(): void {
    this._disposeHandlers?.();
    this._disposeHandlers = undefined;
  }
}
