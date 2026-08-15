import type { BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import { auxiliaryGenerationRpcModule } from "../auxiliary-generation/auxiliary-generation-rpc-feature";
import { CommandRegistry, type CommandSink } from "../di/command-registry";
import type { DesktopWindowScope } from "../di/process-container";
import { RpcRegistry, type RpcEventSink } from "../di/rpc-registry";
import { windowRegistryModule } from "../di/window-registry-module";
import { generatorContributionsModule } from "../generator/generator-module";
import { modelsRpcModule } from "../models/models-rpc-feature";
import { appDirectoriesRpcModule } from "../native/app-directories-module";
import { nativeDialogsContributionsModule } from "../native/native-dialogs-module";
import { nativeFilesRpcModule } from "../native/native-files-module";
import {
  nativeWindowModule,
  type NativeWindowStateBinding,
  WINDOW_APPLICATION,
  type WindowApplication,
} from "../native/native-window-module";
import { shellCommandsModule } from "../native/shell-module";
import { playgroundContributionsModule } from "../playgrounds/playground-module";
import { agentProjectsContributionsModule } from "../projects/agent-projects-module";
import { projectContributionsModule } from "../projects/project-module";
import {
  createMainWindowRPC,
  type MainWindowRPC,
  type MainWindowRPCController,
} from "../rpc";
import { analyticsRpcModule } from "../rpc/analytics-rpc-feature";
import { builtinToolsRpcModule } from "../rpc/builtin-tools-rpc-feature";
import { githubAccountRpcModule } from "../rpc/github-account-rpc-feature";
import { mcpRpcModule } from "../rpc/mcp-rpc-feature";
import { networkRpcModule } from "../rpc/network-rpc-feature";
import { promptFilesRpcModule } from "../rpc/prompt-files-rpc-feature";
import { remindersRpcModule } from "../rpc/reminders-rpc-feature";
import { searchRpcModule } from "../rpc/search-rpc-feature";
import { skillsRpcModule } from "../rpc/skills-rpc-feature";
import { updatesRpcModule } from "../rpc/updates-rpc-feature";
import { threadSharingRpcModule } from "../thread-sharing/thread-sharing-rpc-feature";

export type DesktopWindowKind = "main" | "project";

/**
 * Own one window's DI contributions, transport registries, RPC bridge, and
 * native-close handshake as a single lifecycle module.
 */
export class DesktopWindowRuntime {
  private readonly _commands: CommandRegistry;
  private readonly _rpcRegistry: RpcRegistry;
  private readonly _controller: MainWindowRPCController;
  private readonly _windowApplication: WindowApplication;
  private _window: BrowserWindow | undefined;
  private _nativeClosed = false;
  private _disposePromise: Promise<void> | undefined;

  constructor(
    private readonly _scope: DesktopWindowScope,
    private readonly _kind: DesktopWindowKind
  ) {
    const rpcBridge: { current?: MainWindowRPC } = {};
    const requireRpcBridge = (): MainWindowRPC => {
      if (rpcBridge.current === undefined) {
        throw new Error(`RPC bridge for ${_kind} window is not ready.`);
      }
      return rpcBridge.current;
    };
    const commandSink: CommandSink = {
      sendToWebview: (command) =>
        requireRpcBridge().send.executeCommand(command),
    };
    const rpcEventSink: RpcEventSink = {
      sendStreamEvent: (event) =>
        requireRpcBridge().send.rpcNamespaceStreamEvent(event),
      sendEvent: (event) =>
        requireRpcBridge().send.rpcNamespaceEvent(event),
    };

    this._loadFeatureModules(commandSink);
    _scope.load(windowRegistryModule(_scope, { commandSink, rpcEventSink }));
    this._windowApplication = _scope.get(WINDOW_APPLICATION);
    this._commands = _scope.get(CommandRegistry);
    this._rpcRegistry = _scope.get(RpcRegistry);
    this._commands.onStart();
    this._rpcRegistry.onStart();
    this._controller = createMainWindowRPC({
      executeCommand: (command) => this._commands.execute(command),
      rpcRegistry: this._rpcRegistry,
    });
    rpcBridge.current = this._controller.rpc;
    _scope.onDispose(() => this.dispose());
  }

  /** Electrobun bridge passed to the native window factory. */
  get rpc(): MainWindowRPC {
    return this._controller.rpc;
  }

  /** Finish window binding after the native factory returns its BrowserWindow. */
  attach(window: BrowserWindow, state: NativeWindowStateBinding): void {
    if (this._window !== undefined) {
      throw new Error(`Desktop ${this._kind} window runtime is already attached.`);
    }
    this._window = window;
    window.on("close", () => {
      this._nativeClosed = true;
      void this._scope.dispose().catch((error) => {
        console.error(
          `Failed to dispose window scope "${this._scope.id}":`,
          error
        );
      });
    });
    this._windowApplication.attach(window, state);
  }

  /** Dispatch a native menu action into this window's command registry. */
  execute(command: Command): void {
    this._commands.execute(command);
  }

  /** Stop transports before closing the native window. */
  dispose(): Promise<void> {
    this._disposePromise ??= this._dispose();
    return this._disposePromise;
  }

  private _loadFeatureModules(commandSink: CommandSink): void {
    this._scope.load(threadSharingRpcModule());
    this._scope.load(githubAccountRpcModule());
    this._scope.load(updatesRpcModule());
    this._scope.load(remindersRpcModule());
    this._scope.load(analyticsRpcModule());
    this._scope.load(
      agentProjectsContributionsModule(this._kind === "main")
    );
    this._scope.load(generatorContributionsModule());
    this._scope.load(nativeDialogsContributionsModule(commandSink));
    this._scope.load(nativeFilesRpcModule());
    this._scope.load(appDirectoriesRpcModule());
    this._scope.load(nativeWindowModule());
    this._scope.load(shellCommandsModule());
    this._scope.load(auxiliaryGenerationRpcModule());
    this._scope.load(modelsRpcModule());
    this._scope.load(promptFilesRpcModule());
    this._scope.load(mcpRpcModule());
    this._scope.load(builtinToolsRpcModule());
    this._scope.load(searchRpcModule());
    this._scope.load(networkRpcModule());
    this._scope.load(skillsRpcModule());
    this._scope.load(
      this._kind === "main"
        ? playgroundContributionsModule()
        : projectContributionsModule()
    );
  }

  private async _dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const resource of [this._rpcRegistry, this._commands]) {
      try {
        await resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this._window !== undefined && !this._nativeClosed) {
      try {
        this._window.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to dispose desktop ${this._kind} window runtime.`
      );
    }
  }
}
