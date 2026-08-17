import type { BrowserWindow } from "electrobun/bun";
import { Container, ContainerModule, inject, injectable } from "inversify";

import type { Command } from "../../shared/commands";
import { Emitter, type Event } from "../../shared/event";
import type { RpcEventSink } from "../di/rpc-registry";
import { APP_HOME_PATH } from "../native/app-directories-module";
import type { AgentProject } from "../projects/agent-project";
import type {
  ProjectWindowAdapter,
  ProjectWindowHandle,
} from "../projects/project-window-manager";
import { ProjectWindowStateFile } from "../projects/project-window-state";
import type { MainWindowRPC } from "../rpc";

import type { DesktopWindowCommandRouter } from "./desktop-window-command-router";
import {
  DESKTOP_WINDOW_CLOSE,
  DESKTOP_WINDOW_KIND,
  type DesktopWindowClose,
  type DesktopWindowCompositionContext,
  DesktopWindowRuntime,
} from "./desktop-window-runtime";
import { MainWindowApplication } from "./main-window-application";
import {
  NATIVE_WINDOW_FACTORY,
  type NativeWindowFactory,
} from "./native-window-factory";
import { ProjectWindowApplication } from "./project-window-application";
import { createAgentProjectWindow, createMainWindow } from "./window";
import type { DesktopWindowApplication } from "./window-application";
import type {
  MainWindowContainerHandle,
  WindowContainerFactory,
} from "./window-container-factory";

export type DesktopMainWindowHandle = MainWindowContainerHandle;

/** Bootstrap-owned registrations needed across the staged window lifecycle. */
export interface DesktopWindowComposition {
  configureMainIdentity(container: Container): void;
  configureProjectSource(container: Container, project: AgentProject): void;
  configureRuntime(
    container: Container,
    context: DesktopWindowCompositionContext
  ): void;
}

export const DESKTOP_CONTAINER = Symbol("DesktopContainer");
export const DESKTOP_WINDOW_COMPOSITION = Symbol("DesktopWindowComposition");

interface OwnedWindowContainer {
  readonly container: Container;
  readonly closed: Emitter<void>;
  readonly onDidClose: Event<void>;
  application?: DesktopWindowApplication;
  dispose(): Promise<void>;
}

/** Create Main and Project native windows around one owned DI scope. */
@injectable()
export class DesktopWindowFactory
  implements
    ProjectWindowAdapter,
    DesktopWindowCommandRouter,
    WindowContainerFactory
{
  private readonly _applications = new Map<number, DesktopWindowApplication>();

  constructor(
    @inject(DESKTOP_CONTAINER)
    private readonly _desktop: Container,
    @inject(APP_HOME_PATH)
    private readonly _homePath: string,
    @inject(DESKTOP_WINDOW_COMPOSITION)
    private readonly _composition: DesktopWindowComposition
  ) {}

  /** Create Main in a fresh child Container owned through native close. */
  async createMain(): Promise<DesktopMainWindowHandle> {
    const owned = this._createContainer("main", "main");
    try {
      this._composition.configureMainIdentity(owned.container);
      const application = this._resolveMainApplication(owned);
      const window = await application.start();
      this._trackApplication(owned, window, application);
      return {
        window,
        rpc: application.rpc,
        onDidClose: owned.onDidClose,
        activate: () => window.activate(),
        close: () => owned.dispose(),
      };
    } catch (error) {
      await this._cleanupFailedContainer(owned, "Main");
      throw error;
    }
  }

  /** Create an isolated Project Studio window and own creation-failure cleanup. */
  async create(project: AgentProject): Promise<ProjectWindowHandle> {
    const owned = this._createContainer(`project:${project.id}`, "project");
    try {
      this._composition.configureProjectSource(owned.container, project);
      const application = this._resolveProjectApplication(owned, project.id);
      const window = await application.start();
      this._trackApplication(owned, window, application);
      return {
        onDidClose: owned.onDidClose,
        activate: () => window.activate(),
        close: () => owned.dispose(),
      };
    } catch (error) {
      await this._cleanupFailedContainer(owned, "Agent Project");
      throw error;
    }
  }

  /** Route a native menu command to the Registry owned by its window. */
  executeCommand(command: Command, window: BrowserWindow): void {
    const application = this._applications.get(window.id);
    if (application === undefined) {
      throw new Error(
        `Desktop window Application is unavailable for window ${window.id}.`
      );
    }
    application.execute(command);
  }

  private _trackApplication(
    owned: OwnedWindowContainer,
    window: BrowserWindow,
    application: DesktopWindowApplication
  ): void {
    this._applications.set(window.id, application);
    owned.onDidClose(() => this._applications.delete(window.id));
  }

  /** Create one sibling child and its idempotent two-phase cleanup owner. */
  private _createContainer(
    id: string,
    kind: "main" | "project"
  ): OwnedWindowContainer {
    const container = new Container({ parent: this._desktop });
    const closed = new Emitter<void>();
    let didClose = false;
    let disposePromise: Promise<void> | undefined;
    const owned: OwnedWindowContainer = {
      container,
      closed,
      onDidClose: (listener) => {
        // Native close may finish while Application.start() is still awaiting.
        // Replaying this terminal fact prevents late owners retaining dead handles.
        if (didClose) {
          listener();
          return { dispose: () => undefined };
        }
        return closed.event(listener);
      },
      dispose: () => {
        disposePromise ??= (async () => {
          const errors: unknown[] = [];
          try {
            await owned.application?.stop();
          } catch (error) {
            errors.push(error);
          }
          try {
            await container.unbindAllAsync();
          } catch (error) {
            errors.push(error);
          }
          didClose = true;
          closed.fire();
          closed.dispose();
          if (errors.length > 0) {
            throw new AggregateError(
              errors,
              `Failed to dispose ${kind} window Container "${id}".`
            );
          }
        })();
        return disposePromise;
      },
    };
    return owned;
  }

  /** Finish Common/Main composition, then resolve the sole child root. */
  private _resolveMainApplication(
    owned: OwnedWindowContainer
  ): MainWindowApplication {
    const native: NativeWindowFactory = {
      create: (_context, rpc, attach) =>
        createMainWindow({ rpc, onCreated: attach }),
    };
    const connectRpc = this._configureApplication(owned, "main", native);
    owned.container.load(
      new ContainerModule(({ bind }) => {
        bind(MainWindowApplication).toSelf().inSingletonScope();
      })
    );
    const application = owned.container.get(MainWindowApplication);
    owned.application = application;
    connectRpc(application);
    return application;
  }

  /** Finish Common/Project composition, then resolve the sole child root. */
  private _resolveProjectApplication(
    owned: OwnedWindowContainer,
    projectId: string
  ): ProjectWindowApplication {
    const native: NativeWindowFactory = {
      create: async (context, rpc, attach) => {
        if (context.kind !== "agentProject") {
          throw new Error("Project native factory received a Main context.");
        }
        const stateStore = await ProjectWindowStateFile.load(
          this._homePath,
          projectId
        );
        return createAgentProjectWindow({
          rpc,
          project: context.project,
          stateStore,
          onCreated: attach,
        });
      },
    };
    const connectRpc = this._configureApplication(owned, "project", native);
    owned.container.load(
      new ContainerModule(({ bind }) => {
        bind(ProjectWindowApplication).toSelf().inSingletonScope();
      })
    );
    const application = owned.container.get(ProjectWindowApplication);
    owned.application = application;
    connectRpc(application);
    return application;
  }

  /** Bind transport infrastructure before resolving an Application root. */
  private _configureApplication(
    owned: OwnedWindowContainer,
    kind: "main" | "project",
    native: NativeWindowFactory
  ): (application: DesktopWindowApplication) => void {
    const rpcBridge: { current?: MainWindowRPC } = {};
    const requireRpc = (): MainWindowRPC => {
      if (rpcBridge.current === undefined) {
        throw new Error(`RPC bridge for ${kind} window is not ready.`);
      }
      return rpcBridge.current;
    };
    const rpcEventSink: RpcEventSink = {
      sendStreamEvent: (event) =>
        requireRpc().send.rpcNamespaceStreamEvent(event),
      sendEvent: (event) => requireRpc().send.rpcNamespaceEvent(event),
    };
    this._composition.configureRuntime(owned.container, {
      kind,
      rpcEventSink,
    });
    owned.container.load(
      new ContainerModule(({ bind }) => {
        bind(DESKTOP_WINDOW_KIND).toConstantValue(kind);
        bind<NativeWindowFactory>(NATIVE_WINDOW_FACTORY).toConstantValue(
          native
        );
        bind<DesktopWindowClose>(DESKTOP_WINDOW_CLOSE).toConstantValue({
          requestClose: () => {
            void owned.dispose().catch((error) => {
              console.error(`Failed to dispose ${kind} window:`, error);
            });
          },
        });
        bind(DesktopWindowRuntime).toSelf().inSingletonScope();
      })
    );
    // The root resolves DesktopWindowRuntime as its dependency; this bridge is
    // assigned immediately after root resolution and before start() registers
    // event sources that may publish into the renderer transport.
    const connectRpc = (application: DesktopWindowApplication): void => {
      rpcBridge.current = application.rpc;
    };
    owned.onDidClose(() => {
      rpcBridge.current = undefined;
    });
    return connectRpc;
  }

  /** Preserve the original creation error while reporting failed cleanup. */
  private async _cleanupFailedContainer(
    owned: OwnedWindowContainer,
    label: string
  ): Promise<void> {
    try {
      await owned.dispose();
    } catch (cleanupError) {
      console.error(
        `Failed to dispose ${label} Container after creation failed:`,
        cleanupError
      );
    }
  }
}
