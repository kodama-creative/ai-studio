import { createHash, randomUUID } from "node:crypto";
import { constants, mkdirSync } from "node:fs";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { getThreadRuntimeProfile } from "@llm-space/core";
import { BrowserView, type BrowserWindow, Utils } from "electrobun/bun";

import type { ModelProviderGroup } from "@llm-space/core";
import type { LocalFileSystem } from "@llm-space/core/server";

import { moveToTrash, revealInFileManager } from "../fs";

import type { Command } from "../../shared/commands";
import type { DesktopRPCType } from "../../shared/rpc";
import type { Analytics } from "../analytics";
import type { ExternalAgentProjectManager } from "../external-projects";
import type { EmbeddedLocalServerManager } from "../local-server";
import type { McpManager } from "../mcp";
import type { ModelManager } from "../models";
import type { DesktopSandboxManager } from "../sandbox";
import type { SearchSettingsManager } from "../search";
import type { SkillsManager } from "../skills";
import type { StreamThreadController } from "../streaming";
import type { ToolRegistry } from "../tools/tool-registry";
import type { TraceManager } from "../traces";
import type { UpdaterService } from "../updates";

async function _getModelProviderGroups(modelManager: ModelManager) {
  const models = await modelManager.getAvailableModels();
  return Promise.all(
    models.getProviders().map(async provider => ({
      id: provider.id,
      name: provider.name,
      builtin: modelManager.isBuiltin(provider.id),
      models: provider.getModels(),
      apiKey: modelManager.getRawApiKey(provider.id),
      baseUrl: modelManager.getBaseUrl(provider.id),
      headers: modelManager.getHeaders(provider.id),
      api: modelManager.getApi(provider.id),
      disabledModels: modelManager.getDisabledModels(provider.id),
      customModels: modelManager.getCustomModels(provider.id),
      websiteLink: modelManager.getWebsiteLink(provider.id),
      icon: modelManager.getProviderIcon(provider.id)
    }))
  ) as Promise<ModelProviderGroup[]>;
}

/**
 * The stream handler references its RPC instance inside the initializer, so an
 * explicit annotation keeps TypeScript from inferring the recursive value as
 * `any`.
 */
export type MainWindowRPC = ReturnType<
  typeof BrowserView.defineRPC<DesktopRPCType>
>;

export interface MainWindowRPCDependencies {
  analytics: Analytics;
  externalAgentProjects: ExternalAgentProjectManager;
  onAgentSourceDirtyStateChanged: (dirty: boolean) => void;
  onDiscardDirtyAgentSourcesResolved: (
    requestId: string,
    discard: boolean
  ) => void;
  executeCommand: (command: Command) => void;
  getMainWindow: () => BrowserWindow;
  homePath: string;
  localFs: LocalFileSystem;
  localServers: EmbeddedLocalServerManager;
  mcpManager: McpManager;
  modelManager: ModelManager;
  searchSettings: SearchSettingsManager;
  sandboxes: DesktopSandboxManager;
  skillsManager: SkillsManager;
  streaming: StreamThreadController;
  tools: ToolRegistry;
  traceManager: TraceManager;
  updater: UpdaterService;
}

const MAX_REQUEST_TIME_MS = (5 * 60_000) + 10_000;

export function createMainWindowRPC({
  analytics,
  externalAgentProjects,
  onAgentSourceDirtyStateChanged,
  onDiscardDirtyAgentSourcesResolved,
  executeCommand,
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
  tools,
  traceManager,
  updater
}: MainWindowRPCDependencies): MainWindowRPC {
  const getModelProviderGroups = async () => _getModelProviderGroups(modelManager);
  const rpc: MainWindowRPC = BrowserView.defineRPC<DesktopRPCType>({
    maxRequestTime: MAX_REQUEST_TIME_MS,
    handlers: {
      requests: {
        decideToolApproval: async input => streaming.decideToolApproval(input),
        availableModels: async () => getModelProviderGroups(),
        removeProvider: async ({ providerId }) => {
          modelManager.removeProvider(providerId);
          return getModelProviderGroups();
        },
        builtinProviders: async () => modelManager.getBuiltinProviders(),
        addProvider: async ({ providerId }) => {
          modelManager.addBuiltInProvider({ id: providerId });
          analytics.capture("provider_added", { providerId, kind: "builtin" });
          return getModelProviderGroups();
        },
        addCustomProvider: async ({ id, name, baseUrl, api }) => {
          modelManager.addCustomProvider({ id, name, baseUrl, api });
          // Only the provider id is recorded — never the base URL or name.
          analytics.capture("provider_added", {
            providerId: id,
            kind: "custom"
          });
          return getModelProviderGroups();
        },
        updateProvider: async ({
          providerId,
          apiKey,
          baseUrl,
          headers,
          name,
          api,
          icon
        }) => {
          modelManager.updateProvider(providerId, {
            apiKey,
            baseUrl,
            headers,
            name,
            api,
            icon
          });
          return getModelProviderGroups();
        },
        setModelEnabled: async ({ providerId, modelId, enabled }) => {
          modelManager.setModelEnabled(providerId, modelId, enabled);
          return getModelProviderGroups();
        },
        setAllModelsEnabled: async ({ providerId, enabled }) => {
          modelManager.setAllModelsEnabled(providerId, enabled);
          return getModelProviderGroups();
        },
        getDefaultModel: async () => Promise.resolve(modelManager.getDefaultModel()),
        setDefaultModel: async ({ model }) => {
          modelManager.setDefaultModel(model);
          return Promise.resolve(modelManager.getDefaultModel());
        },
        testModelConnection: async ({ providerId, modelId, candidate }) => {
          await streaming.testModelConnection({
            providerId,
            modelId,
            candidate
          });
          return null;
        },
        removeCustomModel: async ({ providerId, modelId }) => {
          modelManager.removeCustomModel(providerId, modelId);
          return getModelProviderGroups();
        },
        upsertCustomModel: async ({ providerId, model, originalId }) => {
          modelManager.upsertCustomModel(providerId, model, originalId);
          return getModelProviderGroups();
        },
        toggleMaximized: () => {
          const mainWindow = getMainWindow();
          if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
          } else {
            mainWindow.maximize();
          }
          return { maximized: mainWindow.isMaximized() };
        },
        isFullScreen: () => {
          const mainWindow = getMainWindow();
          return { fullScreen: mainWindow.isFullScreen() };
        },
        ensureRootDir: async ({ relativePath }) => {
          const dir = nodePath.join(homePath, relativePath);
          mkdirSync(dir, { recursive: true });
          return Promise.resolve({ path: dir });
        },
        fsLs: async ({ path }) => localFs.ls(path),
        fsMkdir: async ({ path }) => {
          await localFs.mkdir(path);
          return null;
        },
        fsCp: async ({ src, dest }) => {
          await localFs.cp(src, dest);
          return null;
        },
        fsMv: async ({ src, dest }) => {
          await localFs.mv(src, dest);
          return null;
        },
        fsRm: async ({ path }) => {
          // Recoverable delete: move to the OS trash rather than `rm`-ing.
          const abs = localFs.realpath(path);
          if (abs === localFs.realpath("")) {
            throw new Error("Cannot delete the workspace root.");
          }
          await moveToTrash(abs);
          return null;
        },
        fsRead: async ({ path }) => {
          const thread = await localFs.read(path);
          streaming.registerDesktopThreadApprovals(path, thread);
          return thread;
        },
        fsWrite: async ({ path, thread }) => {
          await localFs.write(path, thread);
          return null;
        },
        fsReadText: async ({ path }) => ({
          text: await readFile(localFs.realpath(path), "utf8")
        }),
        fsWriteText: async ({ path, text }) => {
          await writeFile(localFs.realpath(path), text, "utf8");
          return null;
        },
        fsReveal: async ({ path }) => {
          await revealInFileManager(localFs.realpath(path));
          return null;
        },
        revealAbsolutePath: async ({ path: abs }) => {
          try {
            await stat(abs);
          } catch {
            return { existed: false };
          }
          await revealInFileManager(abs);
          return { existed: true };
        },
        revealSkill: async ({ name }) => {
          const found = skillsManager.findSkill(name, { enabledOnly: false });
          if (!found) {
            return { existed: false };
          }
          const file = nodePath.join(found.path, "SKILL.md");
          try {
            await stat(file);
          } catch {
            return { existed: false };
          }
          await revealInFileManager(file);
          return { existed: true };
        },
        fsRealpath: async ({ path }) =>
          Promise.resolve({ path: localFs.realpath(path) }),
        externalAgentProjectBrowse: async () => {
          const selected = await Utils.openFileDialog({
            startingFolder: "~/",
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false
          });
          const directory = selected.map(item => item.trim()).find(Boolean);
          return directory
            ? externalAgentProjects.preview(directory)
            : Promise.resolve(null);
        },
        externalAgentProjectBrowseCreateParent: async () => {
          const selected = await Utils.openFileDialog({
            startingFolder: "~/",
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false
          });
          const directory = selected.map(item => item.trim()).find(Boolean);
          return directory ? { path: directory } : null;
        },
        externalAgentProjectCreate: async input =>
          externalAgentProjects.create(input),
        externalAgentProjectTrustAndOpen: async ({ path }) =>
          externalAgentProjects.trustAndOpen(path),
        externalAgentProjectList: async () => externalAgentProjects.list(),
        externalAgentProjectInspect: async ({ projectId }) =>
          externalAgentProjects.inspect(projectId),
        externalAgentProjectRemove: async ({ projectId }) => {
          await externalAgentProjects.remove(projectId);
          return null;
        },
        externalAgentProjectRefresh: async ({ projectId }) =>
          externalAgentProjects.refresh(projectId),
        externalAgentProjectCreateThread: async ({
          projectId,
          title,
          runtimeProfileType
        }) =>
          externalAgentProjects.createThread(
            projectId,
            title,
            runtimeProfileType
          ),
        externalAgentProjectReadThread: async ({ projectId, threadId }) => {
          const record = await externalAgentProjects.readThread(
            projectId,
            threadId
          );
          streaming.registerAgentProjectThreadApprovals(
            projectId,
            threadId,
            record.thread
          );
          return record;
        },
        externalAgentProjectRuntimeStatus: async ({ projectId, threadId }) => {
          const record = await externalAgentProjects.readThread(
            projectId,
            threadId
          );
          const profile = record.thread.runtimeProfile?.type
            ?? "desktopDirect";
          if (profile === "localServer") {
            return localServers.status(projectId, threadId);
          }
          if (profile === "desktopSandbox") {
            return sandboxes.status(threadId);
          }
          return { state: "ready" as const };
        },
        externalAgentProjectRenameRuntimeBranch: async input =>
          localServers.renameBranch(input),
        externalAgentProjectSandboxStatus: async ({ threadId }) =>
          sandboxes.status(threadId),
        externalAgentProjectSetRuntimeProfile: async ({
          projectId,
          runtimeProfileType,
          threadId
        }) => {
          const current = await externalAgentProjects.readThread(
            projectId,
            threadId
          );
          const currentProfile = getThreadRuntimeProfile(current.thread);
          if (
            currentProfile.type === "desktopSandbox"
            && runtimeProfileType !== "desktopSandbox"
          ) {
            await sandboxes.stop(threadId);
          }
          if (
            currentProfile.type === "localServer"
            && runtimeProfileType === "localServer"
          ) {
            const project = await externalAgentProjects.inspect(projectId);
            if (
              currentProfile.artifactFingerprint
              !== project.artifactFingerprint
            ) {
              await localServers.detachThread(projectId, threadId);
            }
          }
          return externalAgentProjects.setRuntimeProfile(
            projectId,
            threadId,
            runtimeProfileType
          );
        },
        externalAgentProjectStageSandboxFiles: async ({
          projectId,
          threadId,
          messageId
        }) => {
          const record = await externalAgentProjects.readThread(
            projectId,
            threadId
          );
          if (record.thread.runtimeProfile?.type !== "desktopSandbox") {
            throw new Error("Files can be staged only for Desktop Sandbox.");
          }
          const selected = await Utils.openFileDialog({
            startingFolder: "~/",
            canChooseFiles: true,
            canChooseDirectory: false,
            allowsMultipleSelection: true
          });
          const paths = selected.map(item => item.trim()).filter(Boolean);
          if (paths.length === 0) { return []; }
          const attachments = await _readSandboxAttachments(paths);
          const project = await externalAgentProjects.inspect(projectId);
          const snapshot = await externalAgentProjects.getCompiledProject(
            projectId,
            project.snapshot
          );
          const turnId = `${messageId}-${randomUUID()}`;
          const stagedAttachments = await sandboxes.stageAttachments({
            sessionId: threadId,
            messageId,
            turnId,
            seed: snapshot.sandbox?.workspace ?? [],
            attachments
          });
          try {
            await externalAgentProjects.recordSandboxAttachments(
              projectId,
              threadId,
              messageId,
              stagedAttachments
            );
          } catch (error) {
            try {
              await sandboxes.abortAttachmentStaging({
                sessionId: threadId,
                messageId,
                seed: snapshot.sandbox?.workspace ?? []
              });
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                "Unable to persist or remove Sandbox attachments. Run is blocked."
              );
            }
            throw error;
          }
          await sandboxes.completeAttachmentStaging({
            sessionId: threadId,
            messageId,
            attachments: stagedAttachments
          });
          return [...stagedAttachments];
        },
        externalAgentProjectActivateConnections: async ({ projectId, threadId }) =>
          externalAgentProjects.activateConnections(projectId, threadId),
        externalAgentProjectDeactivateConnections: async ({
          projectId,
          threadId
        }) => {
          await externalAgentProjects.deactivateConnections(
            projectId,
            threadId
          );
          return null;
        },
        externalAgentProjectWriteThread: async ({
          projectId,
          threadId,
          record
        }) => {
          await externalAgentProjects.writeThread(projectId, threadId, record);
          return null;
        },
        externalAgentProjectDuplicateThread: async ({ projectId, threadId }) =>
          externalAgentProjects.duplicateThread(projectId, threadId),
        externalAgentProjectDeleteThread: async ({ projectId, threadId }) => {
          await localServers.detachThread(projectId, threadId);
          await sandboxes.delete(threadId);
          await externalAgentProjects.deleteThread(projectId, threadId);
          return null;
        },
        externalAgentProjectSyncThreadFromAgent: async ({ projectId, threadId }) =>
          externalAgentProjects.syncThreadFromAgent(projectId, threadId),
        externalAgentProjectReadSource: async ({ projectId, path }) => ({
          text: await externalAgentProjects.readSource(projectId, path)
        }),
        externalAgentProjectWriteSource: async ({ projectId, path, text }) => {
          await externalAgentProjects.writeSource(projectId, path, text);
          return null;
        },
        externalAgentProjectCallTool: async input =>
          externalAgentProjects.callTool(input),
        mcpListServers: () => mcpManager.listServers(),
        mcpAddServer: ({ server }) => {
          const servers = mcpManager.addServer(server);
          analytics.capture("mcp_server_added", {});
          return servers;
        },
        mcpUpdateServer: async ({ serverId, server }) =>
          mcpManager.updateServer(serverId, server),
        mcpRemoveServer: async ({ serverId }) =>
          mcpManager.removeServer(serverId),
        mcpDisconnectServer: async ({ serverId }) =>
          mcpManager.disconnectServer(serverId),
        mcpListTools: async ({ serverId }) => mcpManager.listTools(serverId),
        mcpCallTool: async ({ serverId, toolName, arguments: args }) =>
          mcpManager.callTool({ serverId, toolName, arguments: args }),
        builtInListTools: () => tools.listTools(),
        builtInCallTool: async ({ name, arguments: args }) =>
          tools.call({ name, arguments: args }),
        getAnalyticsSettings: async () => Promise.resolve(analytics.getSettings()),
        setAnalyticsSettings: async ({ enabled }) =>
          Promise.resolve(analytics.setEnabled(enabled)),
        getSearchSettings: () => searchSettings.get(),
        setSearchSettings: ({ settings }) => searchSettings.set(settings),
        skillsGetSettings: async () => Promise.resolve(skillsManager.getConfig()),
        skillsBrowseForPath: async () => {
          const selected = await Utils.openFileDialog({
            startingFolder: "~/",
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false
          });
          const path = selected.map(p => p.trim()).find(Boolean) ?? null;
          return { path };
        },
        skillsAddPath: async ({ path }) =>
          Promise.resolve(skillsManager.addPath(path)),
        skillsRemovePath: async ({ path }) =>
          Promise.resolve(skillsManager.removePath(path)),
        skillsSetSkillHidden: async ({ path, skillName, hidden }) =>
          Promise.resolve(
            skillsManager.setSkillHidden(path, skillName, hidden)
          ),
        skillsSetAllSkillsHidden: async ({ path, hidden }) =>
          Promise.resolve(skillsManager.setAllSkillsHidden(path, hidden)),
        skillsListSkills: async ({ path }) =>
          Promise.resolve(skillsManager.listSkills(path)),
        skillsReadSkill: async ({ path }) =>
          Promise.resolve(skillsManager.readSkill(path)),
        traceListProjects: async () => traceManager.listProjects(),
        traceCreateProject: async ({ name }) => traceManager.createProject(name),
        traceCreateConnectedProject: async input =>
          traceManager.createConnectedProject(input),
        traceListTraces: async ({ projectId }) => traceManager.listTraces(projectId),
        traceImportLangfuseJson: async ({ projectId, files }) =>
          traceManager.importLangfuseJson(projectId, files),
        traceSearchLangfuseTraces: async ({ projectId, filters }) =>
          traceManager.searchLangfuseTraces({ projectId, filters }),
        traceSyncLangfuseTraces: async ({ projectId, traceIds }) =>
          traceManager.syncLangfuseTraces({ projectId, traceIds }),
        traceReadTrace: async ({ projectId, traceKey }) =>
          traceManager.readTrace(projectId, traceKey),
        traceReadOrCreateWorkbench: async ({ projectId, traceKey }) =>
          traceManager.readOrCreateWorkbench(projectId, traceKey),
        traceUpdateTraceTitle: async ({ projectId, traceKey, title }) =>
          traceManager.updateTraceTitle(projectId, traceKey, title),
        traceWriteWorkbench: async ({ projectId, traceKey, thread }) => {
          await traceManager.writeWorkbench(projectId, traceKey, thread);
          return null;
        },
        updateMode: async () => updater.getUpdateModeSetting(),
        setUpdateMode: async ({ mode }) => {
          await updater.setUpdateModeSetting(mode);
          return null;
        },
        pendingInstalledVersion: () => updater.getInstalledVersion()
      },
      messages: {
        sendStreamThreadRequest: payload => {
          // Fire-and-forget: stream events back as `receiveStreamThreadResponse`
          // messages. `rpc` is initialized by the time this handler runs.
          void streaming.run(payload, message => {
            rpc.send.receiveStreamThreadResponse(message);
          });
        },
        abortStreamThread: payload => { streaming.abort(payload); },
        agentSourceDirtyStateChanged: ({ dirty }) => { onAgentSourceDirtyStateChanged(dirty); },
        resolveDiscardDirtyAgentSources: ({ requestId, discard }) => { onDiscardDirtyAgentSourcesResolved(requestId, discard); },
        captureAnalyticsEvent: ({ event, properties }) => { analytics.capture(event, properties); },
        executeCommand: command => { executeCommand(command); }
      }
    }
  });
  externalAgentProjects.setOnChange(projectId => {
    rpc.send.externalAgentProjectChanged({ projectId });
  });
  return rpc;
}

async function _readSandboxAttachments(paths: readonly string[]) {
  if (paths.length > 20) {
    throw new TypeError("A Turn supports at most 20 attachments.");
  }
  const names = new Set<string>();
  let totalBytes = 0;
  return Promise.all(paths.map(async filePath => {
    const name = nodePath.basename(filePath);
    let handle;
    try {
      handle = await open(
        filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
    } catch {
      throw new Error(`Unable to read attachment: ${name}`);
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new TypeError("Sandbox attachments must be regular files.");
      }
      if (info.size > 25 * 1024 * 1024) {
        throw new TypeError(`Attachment exceeds 25 MiB: ${name}`);
      }
      totalBytes += info.size;
      if (totalBytes > 100 * 1024 * 1024) {
        throw new TypeError("Turn attachments exceed 100 MiB.");
      }
      if (names.has(name)) {
        throw new TypeError(`Duplicate attachment name: ${name}`);
      }
      names.add(name);
      const content = await handle.readFile();
      if (content.byteLength !== info.size) {
        throw new Error(`Attachment changed while staging: ${name}`);
      }
      return {
        id: randomUUID(),
        name,
        fingerprint: createHash("sha256").update(content).digest("hex"),
        content: new Uint8Array(content)
      };
    } finally {
      await handle.close();
    }
  }));
}
