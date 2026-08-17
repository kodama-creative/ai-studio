"use client";

import { HostServicesProvider, type HostServices } from "@llm-space/ui/host";
import { useMemo, type ReactNode } from "react";

import {
  APP_DIRECTORIES_CLIENT,
  AUXILIARY_GENERATION_CLIENT,
  BUILTIN_TOOLS_CLIENT,
  MCP_CLIENT,
  NATIVE_DIALOGS_CLIENT,
  NATIVE_FILES_CLIENT,
  PROMPT_FILES_CLIENT,
  SKILLS_CLIENT,
} from "@/app/di/common-module";
import { useInject } from "@/app/di/react";
import { createToolExecutor } from "@/client/tool-execution";
import { useCommands } from "@/commands";
import type { SettingsTab } from "@/shared/commands";

import { createDesktopShareThreadAction } from "./share-thread-action";

/**
 * Provides the desktop {@link HostServices} to the shared Thread Playground:
 * the RPC transport, tool execution, skills/mcp/paths clients, and navigation
 * routed through the command bus. Must sit inside `CommandProvider`.
 */
export function DesktopHostProvider({ children }: { children: ReactNode }) {
  const { executeCommand, registerCommandHandlers } = useCommands();
  const auxiliaryGeneration = useInject(AUXILIARY_GENERATION_CLIENT);
  const appDirectories = useInject(APP_DIRECTORIES_CLIENT);
  const builtinTools = useInject(BUILTIN_TOOLS_CLIENT);
  const dialogs = useInject(NATIVE_DIALOGS_CLIENT);
  const mcp = useInject(MCP_CLIENT);
  const nativeFiles = useInject(NATIVE_FILES_CLIENT);
  const promptFiles = useInject(PROMPT_FILES_CLIENT);
  const skills = useInject(SKILLS_CLIENT);
  const executeTool = useMemo(
    () => createToolExecutor(mcp, builtinTools),
    [builtinTools, mcp]
  );

  const value = useMemo<HostServices>(
    () => ({
      presentational: false,
      auxiliaryGeneration,
      executeTool,
      skills: {
        getSettings: () => skills.getSettings(),
        listAvailable: () => skills.listAvailable(),
        listSkills: (path) => skills.list(path),
      },
      mcp: {
        listServers: () => mcp.listServers(),
        listTools: (serverId) => mcp.listTools(serverId),
      },
      builtinTools: {
        list: () => builtinTools.list(),
        fsReveal: (path) => nativeFiles.reveal(path),
      },
      paths: { ensureRootDir: (path) => appDirectories.ensure(path) },
      files: {
        readText: (path) => promptFiles.readText(path),
        exists: (path) => promptFiles.exists(path),
        directoryExists: (path) => nativeFiles.directoryExists(path),
        pickFile: () => dialogs.pickFile(),
        pickDirectory: () => dialogs.pickDirectory(),
      },
      actions: {
        openSettings: (tab) =>
          executeCommand({
            type: "app.openSettings",
            args: { tab: tab as SettingsTab },
          }),
        openLink: (url) =>
          executeCommand({ type: "shell.openLink", args: { url } }),
        shareThread: createDesktopShareThreadAction(executeCommand),
        openVariables: (variableName) =>
          executeCommand({
            type: "thread.openVariables",
            args: { variableName },
          }),
        registerOpenVariables: (handler) =>
          registerCommandHandlers({
            "thread.openVariables": ({ variableName }) => handler(variableName),
          }),
        registerRunThread: (run) =>
          registerCommandHandlers({ "thread.run": () => run() }),
      },
    }),
    [
      appDirectories,
      auxiliaryGeneration,
      builtinTools,
      dialogs,
      executeCommand,
      executeTool,
      mcp,
      nativeFiles,
      promptFiles,
      registerCommandHandlers,
      skills,
    ]
  );

  return <HostServicesProvider value={value}>{children}</HostServicesProvider>;
}
