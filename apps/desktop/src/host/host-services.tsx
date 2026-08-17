"use client";

import { HostServicesProvider, type HostServices } from "@llm-space/ui/host";
import { useMemo, type ReactNode } from "react";

import { useInject } from "@/app/di/react";
import { useCommands } from "@/commands";
import { createToolExecutor } from "@/host/tool-execution";
import {
  APP_DIRECTORIES_SERVICE,
  type AppDirectoriesRequests,
} from "@/shared/app-directories-rpc";
import {
  AUXILIARY_GENERATION_SERVICE,
  type AuxiliaryGenerationRpc,
} from "@/shared/auxiliary-generation-rpc";
import {
  BUILTIN_TOOLS_SERVICE,
  type BuiltinToolsRequests,
} from "@/shared/builtin-tools-rpc";
import type { SettingsTab } from "@/shared/commands";
import { MCP_SERVICE, type McpRequests } from "@/shared/mcp-rpc";
import type { RpcClient } from "@/shared/namespaced-rpc";
import {
  NATIVE_DIALOGS_SERVICE,
  type NativeDialogsRequests,
} from "@/shared/native-dialogs-rpc";
import {
  NATIVE_FILES_SERVICE,
  type NativeFilesRequests,
} from "@/shared/native-files-rpc";
import {
  PROMPT_FILES_SERVICE,
  type PromptFilesRequests,
} from "@/shared/prompt-files-rpc";
import { SKILLS_SERVICE, type SkillsRequests } from "@/shared/skills-rpc";

import { createDesktopShareThreadAction } from "./share-thread-action";

/**
 * Provides the desktop {@link HostServices} to the shared Thread Playground:
 * the RPC transport, tool execution, skills/mcp/paths clients, and navigation
 * routed through the command bus. Must sit inside `CommandProvider`.
 */
export function DesktopHostProvider({ children }: { children: ReactNode }) {
  const { executeCommand, registerCommandHandlers } = useCommands();
  const auxiliaryGeneration = useInject<RpcClient<AuxiliaryGenerationRpc>>(
    AUXILIARY_GENERATION_SERVICE
  );
  const appDirectories = useInject<AppDirectoriesRequests>(
    APP_DIRECTORIES_SERVICE
  );
  const builtinTools = useInject<BuiltinToolsRequests>(BUILTIN_TOOLS_SERVICE);
  const dialogs = useInject<NativeDialogsRequests>(NATIVE_DIALOGS_SERVICE);
  const mcp = useInject<McpRequests>(MCP_SERVICE);
  const nativeFiles = useInject<NativeFilesRequests>(NATIVE_FILES_SERVICE);
  const promptFiles = useInject<PromptFilesRequests>(PROMPT_FILES_SERVICE);
  const skills = useInject<SkillsRequests>(SKILLS_SERVICE);
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
