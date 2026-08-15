"use client";

import {
  HostServicesProvider,
  type HostServices,
  type ModelClient,
} from "@llm-space/ui/host";
import { useMemo, type ReactNode } from "react";

import { createAuxiliaryGenerationClient } from "@/client/auxiliary-generation-client";
import { fsReveal, listBuiltInTools } from "@/client/built-in-tools";
import {
  checkUv,
  openGeneratorDevTerminal,
  pickGeneratorDirectory,
  prepareGeneratorDirectory,
  removeProjectFile,
  resolveGeneratorEnv,
  runUv,
  writeProjectFile,
} from "@/client/generator";
import { createMcpClient } from "@/client/mcp";
import { modelsClient } from "@/client/models";
import {
  directoryExists,
  ensureRootDir,
  pickDirectory,
  pickFile,
  readTextFile,
  textFileExists,
} from "@/client/paths";
import { createSearchClient } from "@/client/search";
import { createSkillsClient } from "@/client/skills";
import { createToolExecutor } from "@/client/tool-execution";
import { useCommands } from "@/commands";
import type { SettingsTab } from "@/shared/commands";

import { createDesktopShareThreadAction } from "./share-thread-action";
/** The desktop {@link ModelClient}, backed by Electrobun RPC. */
export function createElectrobunModelClient(): ModelClient {
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
  const mcp = useMemo(() => createMcpClient(), []);
  const search = useMemo(() => createSearchClient(), []);
  const skills = useMemo(() => createSkillsClient(), []);
  const executeTool = useMemo(() => createToolExecutor(mcp), [mcp]);

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
        list: () => listBuiltInTools(),
        fsReveal,
      },
      paths: { ensureRootDir },
      files: {
        readText: (path) => readTextFile(path),
        exists: (path) => textFileExists(path),
        directoryExists,
        pickFile,
        pickDirectory,
      },
      generator: {
        pickDirectory: pickGeneratorDirectory,
        prepareDirectory: prepareGeneratorDirectory,
        checkUv,
        runUv,
        writeFile: writeProjectFile,
        removeFile: removeProjectFile,
        openDevTerminal: openGeneratorDevTerminal,
        getSearchSettings: () => search.get(),
        resolveEnv: (
          providerId: string,
          envNames: string[],
          options?: { profileId?: string }
        ) => resolveGeneratorEnv(providerId, envNames, options?.profileId),
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
      auxiliaryGeneration,
      executeCommand,
      executeTool,
      mcp,
      registerCommandHandlers,
      search,
      skills,
    ]
  );

  return <HostServicesProvider value={value}>{children}</HostServicesProvider>;
}
