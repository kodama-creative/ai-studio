import type {
  AgentEvent,
  AgentStreamRequest,
  BuiltinTool,
  CustomModel,
  FileNode,
  ModelConfig,
  ModelProviderGroup,
  SandboxAttachmentDescriptor,
  Thread,
  ThreadAgentRuntimeProvenance,
  ThreadRuntimeProfileType,
  ThreadServerRunLineage
} from "@llm-space/core";
import type {
  AgentProjectMcpConnectionPreset,
  AgentProjectPreset,
  RuntimeExecutionMode
} from "@llm-space/runtime";
import type { StoredRuntimeSession } from "@llm-space/runtime/harness";
import type { RPCSchema } from "electrobun";

import type { AnalyticsEvent, AnalyticsStatus } from "./analytics";
import type { Command } from "./commands";
import type {
  ExternalAgentProjectChangedPayload,
  ExternalAgentProjectConnectionActivation,
  ExternalAgentProjectPreview,
  ExternalAgentProjectRuntimeStatus,
  ExternalAgentProjectSummary,
  ExternalAgentProjectThreadRecord,
  ExternalAgentProjectToolCallResponse,
  ExternalAgentProjectView,
  RemoteToolCallAttempt
} from "./external-agent-project";
import type {
  McpCallToolResponse,
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView
} from "./mcp";
import type { SearchSettings } from "./search";
import type { SkillContent, SkillInfo, SkillsSettings } from "./skills";
import type {
  TraceConnectedProjectInput,
  TraceImportFile,
  TraceImportResult,
  TraceLangfuseSearchInput,
  TraceProject,
  TraceRecord,
  TraceRemoteTraceSummary,
  TraceSyncResult,
  TraceWorkbenchResponse
} from "./traces";
import type { UpdateMode, UpdateStatusChangedPayload } from "./updates";

/** A webview→bun request to start streaming an agent run. */
export interface StreamThreadRequestPayload {
  streamId: string;
  request: AgentStreamRequest;
  runtime?:
    | {
      executionMode: RuntimeExecutionMode;
      modelSource: ThreadAgentRuntimeProvenance["modelSource"];
      projectId: string;
      sandboxAttachmentMessageIds: readonly string[];
      threadId: string;
      type: "agentProject";
    }
    | {
      executionMode: RuntimeExecutionMode;
      threadPath?: string;
      type: "desktopThread";
    }
    | {
      projectId: string;
      threadId: string;
      type: "localServerAgentProject";
    };
}

/** A bun→webview chunk of a streaming agent run, keyed by `streamId`. */
export type StreamThreadResponsePayload =
  | {
    code?:
      | "executionEnvUnavailable"
      | "hostPolicyChanged"
      | "outcomeUnknown"
      | "sandboxUnavailable"
      | "sandboxWorkspaceLost"
      | "structured_output_invalid"
      | "structured_output_missing"
      | "structured_output_too_large";
    message: string;
    streamId: string;
    type: "error";
  }
  | { event: AgentEvent; streamId: string; type: "event"; }
  | {
    lineage: ThreadServerRunLineage;
    streamId: string;
    terminalOutcome?: "cancelled" | "completed" | "failed" | "outcomeUnknown";
    type: "localServerLineage";
  }
  | {
    runtime: ThreadAgentRuntimeProvenance;
    streamId: string;
    type: "runtime";
  }
  | {
    runtimeSession: StoredRuntimeSession;
    streamId: string;
    type: "runtimeSession";
  }
  | {
    status: ExternalAgentProjectRuntimeStatus;
    streamId: string;
    type: "localServerStatus";
  }
  | { streamId: string; type: "done"; };

/** A webview→bun request to abort an in-flight stream. */
export interface AbortStreamThreadPayload {
  streamId: string;
}

export interface DesktopRPCType {
  bun: RPCSchema<{
    // Messages the webview SENDS and the bun side handles.
    messages: {
      abortStreamThread: AbortStreamThreadPayload;
      agentSourceDirtyStateChanged: { dirty: boolean; };
      // Fire-and-forget: a renderer-only, anonymous analytics event. The bun
      // side is the single network egress for telemetry. See `shared/analytics.ts`.
      captureAnalyticsEvent: AnalyticsEvent;
      // A unified command dispatched from the webview to run in the bun process
      // (e.g. window zoom / reload). See `shared/commands.ts`.
      executeCommand: Command;
      resolveDiscardDirtyAgentSources: {
        discard: boolean;
        requestId: string;
      };
      sendStreamThreadRequest: StreamThreadRequestPayload;
    };
    requests: {
      addCustomProvider: {
        params: {
          api?:
            "anthropic-messages" | "openai-completions" | "openai-responses";
          baseUrl: string;
          id: string;
          name: string;
        };
        response: ModelProviderGroup[];
      };
      addProvider: {
        params: { providerId: string; };
        response: ModelProviderGroup[];
      };
      availableModels: {
        params: Record<string, never>;
        response: ModelProviderGroup[];
      };
      builtInCallTool: {
        params: {
          arguments: Record<string, unknown>;
          name: string;
        };
        response: { contentText: string; };
      };
      builtInListTools: {
        params: Record<string, never>;
        response: BuiltinTool[];
      };
      // The builtin providers shipped with the app, each flagged with whether an
      // API key was auto-detected in the environment.
      builtinProviders: {
        params: Record<string, never>;
        response: ModelProviderGroup[];
      };
      // Resolve a directory under the llm-space root, creating it (recursively)
      // if missing, and return its absolute path. The renderer can't touch the
      // filesystem or read the root itself.
      ensureRootDir: {
        params: { relativePath: string; };
        response: { path: string; };
      };
      externalAgentProjectActivateConnections: {
        params: { projectId: string; threadId: string; };
        response: ExternalAgentProjectConnectionActivation;
      };
      externalAgentProjectBrowse: {
        params: Record<string, never>;
        response: ExternalAgentProjectPreview | null;
      };
      externalAgentProjectBrowseCreateParent: {
        params: Record<string, never>;
        response: { path: string; } | null;
      };
      externalAgentProjectCallTool: {
        params: {
          arguments: Record<string, unknown>;
          attempt?: RemoteToolCallAttempt;
          callId: string;
          name: string;
          projectId: string;
          snapshot: string;
          threadId?: string;
        };
        response: ExternalAgentProjectToolCallResponse;
      };
      externalAgentProjectCreate: {
        params: {
          mcpConnection?: AgentProjectMcpConnectionPreset;
          name: string;
          parentDirectory: string;
          presets: AgentProjectPreset[];
        };
        response: ExternalAgentProjectView;
      };
      externalAgentProjectCreateThread: {
        params: {
          projectId: string;
          runtimeProfileType?: ThreadRuntimeProfileType;
          title?: string;
        };
        response: { id: string; record: ExternalAgentProjectThreadRecord; };
      };
      externalAgentProjectDeactivateConnections: {
        params: { projectId: string; threadId: string; };
        response: null;
      };
      externalAgentProjectDeleteThread: {
        params: { projectId: string; threadId: string; };
        response: null;
      };
      externalAgentProjectDuplicateThread: {
        params: { projectId: string; threadId: string; };
        response: { id: string; record: ExternalAgentProjectThreadRecord; };
      };
      externalAgentProjectInspect: {
        params: { projectId: string; };
        response: ExternalAgentProjectView;
      };
      externalAgentProjectList: {
        params: Record<string, never>;
        response: ExternalAgentProjectSummary[];
      };
      externalAgentProjectReadSource: {
        params: { path: string; projectId: string; };
        response: { text: string; };
      };
      externalAgentProjectReadThread: {
        params: { projectId: string; threadId: string; };
        response: ExternalAgentProjectThreadRecord;
      };
      externalAgentProjectRefresh: {
        params: { projectId: string; };
        response: ExternalAgentProjectView;
      };
      externalAgentProjectRemove: {
        params: { projectId: string; };
        response: null;
      };
      externalAgentProjectRuntimeStatus: {
        params: { projectId: string; threadId: string; };
        response: ExternalAgentProjectRuntimeStatus;
      };
      externalAgentProjectSandboxStatus: {
        params: { threadId: string; };
        response: ExternalAgentProjectRuntimeStatus;
      };
      externalAgentProjectSetRuntimeProfile: {
        params: {
          projectId: string;
          runtimeProfileType: ThreadRuntimeProfileType;
          threadId: string;
        };
        response: ExternalAgentProjectThreadRecord;
      };
      externalAgentProjectStageSandboxFiles: {
        params: { messageId: string; projectId: string; threadId: string; };
        response: SandboxAttachmentDescriptor[];
      };
      externalAgentProjectSyncThreadFromAgent: {
        params: { projectId: string; threadId: string; };
        response: ExternalAgentProjectThreadRecord;
      };
      externalAgentProjectTrustAndOpen: {
        params: { path: string; };
        response: ExternalAgentProjectView;
      };
      externalAgentProjectWriteSource: {
        params: { path: string; projectId: string; text: string; };
        response: null;
      };
      externalAgentProjectWriteThread: {
        params: {
          projectId: string;
          record: ExternalAgentProjectThreadRecord;
          threadId: string;
        };
        response: null;
      };
      fsCp: { params: { dest: string; src: string; }; response: null; };
      // Local filesystem / thread storage, mirroring the web `/api/fs/local/*`
      // routes. Void operations resolve to `null`.
      fsLs: { params: { path: string; }; response: FileNode[]; };
      fsMkdir: { params: { path: string; }; response: null; };
      fsMv: { params: { dest: string; src: string; }; response: null; };
      fsRead: { params: { path: string; }; response: Thread; };
      fsReadText: { params: { path: string; }; response: { text: string; }; };
      // Resolve a workspace-relative path to its absolute on-disk path.
      fsRealpath: { params: { path: string; }; response: { path: string; }; };
      // Reveal a file/directory in the OS file manager (Finder/Explorer).
      fsReveal: { params: { path: string; }; response: null; };
      fsRm: { params: { path: string; }; response: null; };
      fsWrite: { params: { path: string; thread: Thread; }; response: null; };
      fsWriteText: { params: { path: string; text: string; }; response: null; };
      // The user's anonymous-analytics opt-out preference plus whether the
      // hard gates allow sending at all (see `shared/analytics.ts`).
      getAnalyticsSettings: {
        params: Record<string, never>;
        response: AnalyticsStatus;
      };
      // The user's chosen default model, or `null` for automatic (first
      // available). Threads with no saved model — or a stale reference — resolve
      // through it.
      getDefaultModel: {
        params: Record<string, never>;
        response: ModelConfig | null;
      };
      // The search provider + API keys backing the built-in web tools.
      getSearchSettings: {
        params: Record<string, never>;
        response: SearchSettings;
      };
      isFullScreen: {
        params: Record<string, never>;
        response: { fullScreen: boolean; };
      };
      mcpAddServer: {
        params: { server: McpServerDraft; };
        response: McpServerView[];
      };
      mcpCallTool: {
        params: {
          arguments: Record<string, unknown>;
          serverId: string;
          toolName: string;
        };
        response: McpCallToolResponse;
      };
      mcpDisconnectServer: {
        params: { serverId: string; };
        response: McpServerView[];
      };
      mcpListServers: {
        params: Record<string, never>;
        response: McpServerView[];
      };
      mcpListTools: {
        params: { serverId: string; };
        response: McpServerToolsResponse;
      };
      mcpRemoveServer: {
        params: { serverId: string; };
        response: McpServerView[];
      };
      mcpUpdateServer: {
        params: { server: McpServerDraft; serverId: string; };
        response: McpServerView[];
      };
      pendingInstalledVersion: {
        params: Record<string, never>;
        response: string | null;
      };
      removeCustomModel: {
        params: { modelId: string; providerId: string; };
        response: ModelProviderGroup[];
      };
      removeProvider: {
        params: { providerId: string; };
        response: ModelProviderGroup[];
      };
      // Reveal an arbitrary absolute path (not confined to the workspace) in the
      // OS file manager. Returns whether the path existed; a missing path is not
      // revealed so the caller can surface a "not found" message.
      revealAbsolutePath: {
        params: { path: string; };
        response: { existed: boolean; };
      };
      // Reveal a skill's `SKILL.md` in the OS file manager, resolved by skill
      // name. Returns whether a matching skill file was found.
      revealSkill: {
        params: { name: string; };
        response: { existed: boolean; };
      };
      setAllModelsEnabled: {
        params: { enabled: boolean; providerId: string; };
        response: ModelProviderGroup[];
      };
      setAnalyticsSettings: {
        params: { enabled: boolean; };
        response: AnalyticsStatus;
      };
      setDefaultModel: {
        params: { model: ModelConfig | null; };
        response: ModelConfig | null;
      };
      setModelEnabled: {
        params: { enabled: boolean; modelId: string; providerId: string; };
        response: ModelProviderGroup[];
      };
      setSearchSettings: {
        params: { settings: SearchSettings; };
        response: SearchSettings;
      };
      setUpdateMode: { params: { mode: UpdateMode; }; response: null; };
      skillsAddPath: {
        params: { path: string; };
        response: SkillsSettings;
      };
      // Open the native folder picker; `path` is null when the user cancels.
      skillsBrowseForPath: {
        params: Record<string, never>;
        response: { path: string | null; };
      };
      // The discovery folders + hidden skills backing the built-in Skill tool.
      skillsGetSettings: {
        params: Record<string, never>;
        response: SkillsSettings;
      };
      // Discover the skills under one folder (name/description/path/enabled).
      skillsListSkills: {
        params: { path: string; };
        response: SkillInfo[];
      };
      // Read one skill's full SKILL.md (frontmatters + body) by its directory.
      skillsReadSkill: {
        params: { path: string; };
        response: SkillContent;
      };
      skillsRemovePath: {
        params: { path: string; };
        response: SkillsSettings;
      };
      // Enable/disable every skill in one folder at once.
      skillsSetAllSkillsHidden: {
        params: { hidden: boolean; path: string; };
        response: SkillsSettings;
      };
      skillsSetSkillHidden: {
        params: { hidden: boolean; path: string; skillName: string; };
        response: SkillsSettings;
      };
      // `candidate` (from the editor dialog) tests an unsaved model config
      // as-is; its `id` overrides `modelId`.
      testModelConnection: {
        params: {
          candidate?: CustomModel;
          modelId: string;
          providerId: string;
        };
        response: null;
      };
      toggleMaximized: {
        params: Record<string, never>;
        response: { maximized: boolean; };
      };
      // Create a connected Langfuse project after validating credentials.
      traceCreateConnectedProject: {
        params: TraceConnectedProjectInput;
        response: TraceProject;
      };
      // Create a manual Langfuse trace project under `traces/projects`.
      traceCreateProject: {
        params: { name: string; };
        response: TraceProject;
      };
      // Import renderer-read Langfuse JSON files into one trace project.
      traceImportLangfuseJson: {
        params: { files: TraceImportFile[]; projectId: string; };
        response: TraceImportResult;
      };
      // List trace projects for the dedicated Trace Panel.
      traceListProjects: {
        params: Record<string, never>;
        response: TraceProject[];
      };
      // List trace summaries for one trace project.
      traceListTraces: {
        params: { projectId: string; };
        response: TraceRecord[];
      };
      // Read or lazily create the editable ThreadPlayground workbench.
      traceReadOrCreateWorkbench: {
        params: { projectId: string; traceKey: string; };
        response: TraceWorkbenchResponse;
      };
      // Read a trace summary by key without creating a workbench.
      traceReadTrace: {
        params: { projectId: string; traceKey: string; };
        response: TraceRecord;
      };
      // Search a bounded remote Langfuse trace list for explicit user sync.
      traceSearchLangfuseTraces: {
        params: { filters?: TraceLangfuseSearchInput; projectId: string; };
        response: TraceRemoteTraceSummary[];
      };
      // Sync selected remote Langfuse trace ids into local trace storage.
      traceSyncLangfuseTraces: {
        params: { projectId: string; traceIds: string[]; };
        response: TraceSyncResult;
      };
      // Rename a trace summary and keep its editable workbench title in sync.
      traceUpdateTraceTitle: {
        params: { projectId: string; title: string; traceKey: string; };
        response: TraceWorkbenchResponse;
      };
      // Persist a trace workbench thread; raw trace data remains immutable.
      traceWriteWorkbench: {
        params: { projectId: string; thread: Thread; traceKey: string; };
        response: null;
      };
      // Update settings + the "we just updated" signal (pulled once on mount,
      // race-free vs. the fire-and-forget `updateStatusChanged` message).
      updateMode: { params: Record<string, never>; response: UpdateMode; };
      updateProvider: {
        params: {
          api?:
            | "anthropic-messages"
            | "openai-completions"
            | "openai-responses"
            | null;
          apiKey?: string | null;
          baseUrl?: string | null;
          headers?: Record<string, string> | null;
          icon?: string | null;
          name?: string | null;
          providerId: string;
        };
        response: ModelProviderGroup[];
      };
      // Create or edit a custom model. `originalId` (present on edits) names the
      // model being replaced, supporting a rename.
      upsertCustomModel: {
        params: {
          model: CustomModel;
          originalId?: string;
          providerId: string;
        };
        response: ModelProviderGroup[];
      };
    };
  }>;
  webview: RPCSchema<{
    // Messages the bun side SENDS and the webview handles.
    messages: {
      // A unified command dispatched from the bun process (native menu / global
      // shortcuts) to run in the webview. See `shared/commands.ts`.
      executeCommand: Command;
      externalAgentProjectChanged: ExternalAgentProjectChangedPayload;
      // OS-level fullscreen state changed (entered/exited).
      fullScreenChanged: { fullScreen: boolean; };
      receiveStreamThreadResponse: StreamThreadResponsePayload;
      requestDiscardDirtyAgentSources: {
        reason: "quit" | "reload";
        requestId: string;
      };
      // App-update flow progress from the bun-side updater service.
      updateStatusChanged: UpdateStatusChangedPayload;
    };
    requests: Record<string, never>;
  }>;
}
