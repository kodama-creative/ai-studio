"use client";

import {
  HostServicesProvider,
  type HostServices,
  type ModelClient,
} from "@llm-space/ui/host";
import { useMemo, type ReactNode } from "react";

import { createAppDirectoriesClient } from "@/client/app-directories";
import { createAuxiliaryGenerationClient } from "@/client/auxiliary-generation-client";
import { createBuiltinToolsClient } from "@/client/built-in-tools";
import { createGeneratorClient } from "@/client/generator";
import { createMcpClient } from "@/client/mcp";
import { createModelsClient } from "@/client/models";
import { createNativeDialogsClient } from "@/client/native-dialogs";
import { createNativeFilesClient } from "@/client/native-files";
import { createPromptFilesClient } from "@/client/prompt-files";
import { createSearchClient } from "@/client/search";
import { createSkillsClient } from "@/client/skills";
import { createToolExecutor } from "@/client/tool-execution";
import { useCommands } from "@/commands";
import type { SettingsTab } from "@/shared/commands";
import type { ModelsRequests } from "@/shared/models-rpc";

import { createDesktopShareThreadAction } from "./share-thread-action";
/** The desktop {@link ModelClient}, backed by Electrobun RPC. */
export function createElectrobunModelClient(
  modelsClient: ModelsRequests = createModelsClient()
): ModelClient {
  return {
    availableModels: () => modelsClient.list(),
    builtinProviders: () => modelsClient.listBuiltin(),
    getDefaultModel: () => modelsClient.getDefault(),
    setDefaultModel: (model) => modelsClient.setDefault(model),
    removeProvider: (providerId) => modelsClient.removeProvider(providerId),
    addProvider: (providerId) => modelsClient.addProvider(providerId),
    addCustomProvider: (input) => modelsClient.addCustomProvider(input),
    addProviderProfile: (providerId) => modelsClient.addProfile(providerId),
    updateProviderProfile: (providerId, profileId, fields) =>
      modelsClient.updateProfile({
        providerId,
        profileId,
        ...fields,
      }),
    removeProviderProfile: (providerId, profileId) =>
      modelsClient.removeProfile(providerId, profileId),
    updateProvider: (providerId, fields) =>
      modelsClient.updateProvider({ providerId, ...fields }),
    setModelEnabled: (providerId, modelId, enabled) =>
      modelsClient.setEnabled(providerId, modelId, enabled),
    setAllModelsEnabled: (providerId, enabled) =>
      modelsClient.setAllEnabled(providerId, enabled),
    testModelConnection: async (providerId, modelId, candidate, profileId) => {
      await modelsClient.testConnection({
        providerId,
        profileId,
        modelId,
        candidate,
      });
    },
    removeCustomModel: (providerId, modelId) =>
      modelsClient.removeCustom(providerId, modelId),
    upsertCustomModel: (providerId, model, originalId) =>
      modelsClient.upsertCustom(providerId, model, originalId),
    setImageModelEnabled: (modelId, enabled) =>
      modelsClient.setImageEnabled(modelId, enabled),
    setAllImageModelsEnabled: (enabled) =>
      modelsClient.setAllImagesEnabled(enabled),
    removeCustomImageModel: (modelId) =>
      modelsClient.removeCustomImage(modelId),
    upsertCustomImageModel: (model, originalId) =>
      modelsClient.upsertCustomImage(model, originalId),
  };
}

/**
 * Provides the desktop {@link HostServices} to the shared Thread Playground:
 * the RPC transport, tool execution, skills/mcp/paths clients, and navigation
 * routed through the command bus. Must sit inside `CommandProvider`.
 */
export function DesktopHostProvider({ children }: { children: ReactNode }) {
  const { executeCommand, registerCommandHandlers } = useCommands();
  const auxiliaryGeneration = useMemo(
    () => createAuxiliaryGenerationClient(),
    []
  );
  const appDirectories = useMemo(() => createAppDirectoriesClient(), []);
  const builtinTools = useMemo(() => createBuiltinToolsClient(), []);
  const dialogs = useMemo(() => createNativeDialogsClient(), []);
  const generator = useMemo(() => createGeneratorClient(), []);
  const mcp = useMemo(() => createMcpClient(), []);
  const nativeFiles = useMemo(() => createNativeFilesClient(), []);
  const promptFiles = useMemo(() => createPromptFilesClient(), []);
  const search = useMemo(() => createSearchClient(), []);
  const skills = useMemo(() => createSkillsClient(), []);
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
      generator: {
        pickDirectory: async () => ({ path: await generator.pickDirectory() }),
        prepareDirectory: (parentDir, projectName) =>
          generator.prepareDirectory(parentDir, projectName),
        checkUv: () => generator.checkUv(),
        runUv: (rootDir, args, options) =>
          generator.runUv(rootDir, args, options),
        writeFile: (rootDir, relativePath, contents) =>
          generator.writeFile(rootDir, relativePath, contents),
        removeFile: (rootDir, relativePath) =>
          generator.removeFile(rootDir, relativePath),
        openDevTerminal: (rootDir) => generator.openDevTerminal(rootDir),
        getSearchSettings: () => search.get(),
        resolveEnv: (
          providerId: string,
          envNames: string[],
          options?: { profileId?: string }
        ) =>
          generator.resolveEnv({
            providerId,
            profileId: options?.profileId,
            envNames,
          }),
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
      generator,
      mcp,
      nativeFiles,
      promptFiles,
      registerCommandHandlers,
      search,
      skills,
    ]
  );

  return <HostServicesProvider value={value}>{children}</HostServicesProvider>;
}
