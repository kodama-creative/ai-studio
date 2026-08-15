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
import { listMcpServers, listMcpTools } from "@/client/mcp";
import {
  directoryExists,
  ensureRootDir,
  pickDirectory,
  pickFile,
  readTextFile,
  textFileExists,
} from "@/client/paths";
import { modelsClient } from "@/client/runtime-rpc-clients";
import { getSearchSettings } from "@/client/search";
import {
  getSkillsSettings,
  listAvailableSkills,
  listSkills,
} from "@/client/skills";
import { executeTool } from "@/client/tool-execution";
import { useCommands } from "@/commands";
import type { SettingsTab } from "@/shared/commands";
import type { RuntimeId } from "@/shared/runtime";

import { createDesktopShareThreadAction } from "./share-thread-action";
/** The desktop {@link ModelClient}, backed by Electrobun RPC. */
export function createElectrobunModelClient(
  runtimeId?: RuntimeId
): ModelClient {
  return {
    availableModels: () => modelsClient.list(runtimeId),
    builtinProviders: () => modelsClient.listBuiltin(runtimeId),
    getDefaultModel: () => modelsClient.getDefault(runtimeId),
    setDefaultModel: (model) => modelsClient.setDefault(runtimeId, model),
    removeProvider: (providerId) =>
      modelsClient.removeProvider(runtimeId, providerId),
    addProvider: (providerId) =>
      modelsClient.addProvider(runtimeId, providerId),
    addCustomProvider: (input) =>
      modelsClient.addCustomProvider(runtimeId, input),
    addProviderProfile: (providerId) =>
      modelsClient.addProfile(runtimeId, providerId),
    updateProviderProfile: (providerId, profileId, fields) =>
      modelsClient.updateProfile(runtimeId, {
        providerId,
        profileId,
        ...fields,
      }),
    removeProviderProfile: (providerId, profileId) =>
      modelsClient.removeProfile(runtimeId, providerId, profileId),
    updateProvider: (providerId, fields) =>
      modelsClient.updateProvider(runtimeId, { providerId, ...fields }),
    setModelEnabled: (providerId, modelId, enabled) =>
      modelsClient.setEnabled(runtimeId, providerId, modelId, enabled),
    setAllModelsEnabled: (providerId, enabled) =>
      modelsClient.setAllEnabled(runtimeId, providerId, enabled),
    testModelConnection: async (providerId, modelId, candidate, profileId) => {
      await modelsClient.testConnection(runtimeId, {
        providerId,
        profileId,
        modelId,
        candidate,
      });
    },
    removeCustomModel: (providerId, modelId) =>
      modelsClient.removeCustom(runtimeId, providerId, modelId),
    upsertCustomModel: (providerId, model, originalId) =>
      modelsClient.upsertCustom(runtimeId, providerId, model, originalId),
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

  const value = useMemo<HostServices>(
    () => ({
      presentational: false,
      auxiliaryGeneration,
      executeTool,
      skills: {
        getSettings: (options) =>
          getSkillsSettings(options?.runtimeId as RuntimeId | undefined),
        listAvailable: (options) =>
          listAvailableSkills(options?.runtimeId as RuntimeId | undefined),
        listSkills: (path, options) =>
          listSkills(path, options?.runtimeId as RuntimeId | undefined),
      },
      mcp: {
        listServers: (options) =>
          listMcpServers(options?.runtimeId as RuntimeId | undefined),
        listTools: (serverId, options) =>
          listMcpTools(serverId, options?.runtimeId as RuntimeId | undefined),
      },
      builtinTools: {
        list: (options) =>
          listBuiltInTools(options?.runtimeId as RuntimeId | undefined),
        fsReveal,
      },
      paths: { ensureRootDir },
      files: {
        readText: (path, options) =>
          readTextFile(path, options.runtimeId as RuntimeId),
        exists: (path, options) =>
          textFileExists(path, options.runtimeId as RuntimeId),
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
        getSearchSettings: (options: { runtimeId: string }) =>
          getSearchSettings(options.runtimeId as RuntimeId),
        resolveEnv: (
          providerId: string,
          envNames: string[],
          options: { runtimeId: string; profileId?: string }
        ) =>
          resolveGeneratorEnv(
            providerId,
            envNames,
            options.profileId,
            options.runtimeId as RuntimeId
          ),
      },
      actions: {
        openSettings: (tab) =>
          executeCommand({
            type: "app.openSettings",
            args: { tab: tab as SettingsTab },
          }),
        openLink: (url) => executeCommand({ type: "shell.openLink", args: { url } }),
        shareThread: createDesktopShareThreadAction(executeCommand),
        openVariables: (variableName) =>
          executeCommand({ type: "thread.openVariables", args: { variableName } }),
        registerOpenVariables: (handler) =>
          registerCommandHandlers({
            "thread.openVariables": ({ variableName }) =>
              handler(variableName),
          }),
        registerRunThread: (run) =>
          registerCommandHandlers({ "thread.run": () => run() }),
      },
    }),
    [auxiliaryGeneration, executeCommand, registerCommandHandlers]
  );

  return <HostServicesProvider value={value}>{children}</HostServicesProvider>;
}
