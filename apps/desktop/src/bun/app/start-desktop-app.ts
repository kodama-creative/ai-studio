import path from "node:path";
import { getLlmSpaceHomePath } from "@llm-space/core/server";
import {
  DockerSandboxProvider,
  validateAgentBundleCompilerSupport
} from "@llm-space/runtime/node";
import Electrobun, {
  app,
  type BrowserWindow,
  type ElectrobunEvent
} from "electrobun/bun";

import { getAgentBundleCompilerSupportPath } from "./get-agent-bundle-compiler-support-path";
import { createShutdownCoordinator } from "./shutdown-coordinator";
import { createMainWindow } from "./window";
import { Analytics } from "../analytics";
import { executeCommandInBun } from "../commands";
import { ExternalEditorManager } from "../external-editor";
import { ExternalAgentProjectManager } from "../external-projects";
import { DesktopHost } from "../host/desktop-host";
import {
  createEmbeddedLocalServerModule,
  EmbeddedLocalServerManager
} from "../local-server";
import { McpManager } from "../mcp";
import { ModelManager } from "../models";
import { createMainWindowRPC, type MainWindowRPC } from "../rpc";
import { DesktopSandboxManager } from "../sandbox";
import { SearchSettingsManager } from "../search";
import { SkillsManager } from "../skills";
import { createLocalFileSystem } from "../storage";
import { StreamThreadController } from "../streaming";
import { createBuiltInToolsModule } from "../tools/built-in";
import { TraceManager } from "../traces";
import { UpdaterService } from "../updates";

import type { Command } from "../../shared/commands";

export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

/** Build and start the production Bun object graph. */
export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  const compilerSupportPath = getAgentBundleCompilerSupportPath();
  await validateAgentBundleCompilerSupport(compilerSupportPath);
  const homePath = getLlmSpaceHomePath();
  const workspacePath = path.join(homePath, "workspace");
  const analytics = new Analytics();
  const modelManager = new ModelManager();
  const sandboxProvider = new DockerSandboxProvider();
  const sandboxes = new DesktopSandboxManager({ homePath, provider: sandboxProvider });
  await sandboxes.start();
  const externalAgentProjects = new ExternalAgentProjectManager({
    homePath,
    workspaceRoot: workspacePath,
    getModels: async () => modelManager.getAvailableModels(),
    sandboxReadiness: async () => sandboxes.readiness(),
    compilerSupportPath
  });
  const externalEditor = new ExternalEditorManager({ homePath });
  const localServers = new EmbeddedLocalServerManager({
    externalAgentProjects,
    homePath,
    sandboxProvider: sandboxes
  });
  const mcpManager = new McpManager();
  const searchSettings = new SearchSettingsManager();
  const skillsManager = new SkillsManager();
  const localFs = createLocalFileSystem(homePath);
  const traceManager = new TraceManager();
  const host = new DesktopHost({
    modules: [
      createBuiltInToolsModule({
        env: process.env,
        findSkill: skillsManager.findSkill.bind(skillsManager),
        getSearchSettings: searchSettings.get.bind(searchSettings),
        workspaceRoot: workspacePath
      }),
      createEmbeddedLocalServerModule(localServers)
    ]
  });
  await host.start();
  const streaming = new StreamThreadController(
    modelManager,
    analytics,
    externalAgentProjects,
    mcpManager,
    host.tools,
    localServers,
    sandboxes,
    localFs
  );

  let mainWindow: BrowserWindow | null = null;
  let rpc: MainWindowRPC | null = null;
  const getRpc = (): MainWindowRPC => {
    if (!rpc) {
      throw new Error("Main window RPC is not ready.");
    }
    return rpc;
  };
  const getMainWindow = (): BrowserWindow => {
    if (!mainWindow) {
      throw new Error("Main window is not ready.");
    }
    return mainWindow;
  };
  const updater = new UpdaterService(message => {
    getRpc().send.updateStatusChanged(message);
  });
  const commandDependencies = {
    sendToWebview: (command: Command) => { getRpc().send.executeCommand(command); },
    updater,
    workspacePath
  };
  const executeCommand = (command: Command, window: BrowserWindow): void => {
    executeCommandInBun(command, window, commandDependencies);
  };

  let stopPromise: Promise<void> | null = null;
  const runtime: DesktopAppRuntime = {
    async stop() {
      stopPromise = stopPromise ?? _stopDesktopApp([
        ["updater", () => { updater.stop(); }],
        ["streaming", () => { streaming.shutdown(); }],
        ["sandboxes", async () => sandboxes.stop()],
        ["desktop host", async () => host.stop()],
        ["external agent projects", async () => externalAgentProjects.shutdown()],
        ["MCP manager", async () => mcpManager.shutdown()],
        ["analytics", async () => analytics.shutdown()]
      ]);
      return stopPromise;
    }
  };

  try {
    rpc = createMainWindowRPC({
      analytics,
      externalAgentProjects,
      externalEditor,
      executeCommand: command => { executeCommand(command, getMainWindow()); },
      getMainWindow,
      homePath,
      localFs,
      localServers,
      mcpManager,
      modelManager,
      searchSettings,
      sandboxes,
      skillsManager,
      streaming,
      tools: host.tools,
      traceManager,
      updater
    });
    mainWindow = await createMainWindow({ rpc, executeCommand });

    analytics.capture("app_opened", { isFirstOpen: analytics.isFirstRun });
    void updater.start();

    const handleBeforeQuit = createShutdownCoordinator({
      quit: () => { app.quit(); },
      stop: async () => runtime.stop()
    });
    Electrobun.events.on(
      "before-quit",
      (event: ElectrobunEvent<Record<string, never>, { allow: boolean; }>) => {
        handleBeforeQuit(event);
      }
    );

    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

async function _stopDesktopApp(
  cleanups: ReadonlyArray<[name: string, cleanup: () => Promise<void> | void]>
): Promise<void> {
  for (const [name, cleanup] of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      console.error(`Failed to stop ${name}:`, error);
    }
  }
}
