export type AgentProjectLayout = "flat" | "nested";

export interface ResolvedAgentProject {
  readonly agentRoot: string;
  readonly appRoot: string;
  readonly layout: AgentProjectLayout;
}

export type AgentDiagnosticSeverity = "error" | "warning";

export interface AgentDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: AgentDiagnosticSeverity;
  readonly sourcePath: string;
}

export type AgentSourceKind =
  "markdown" | "module" | "skill-package" | "workspace";

export interface AgentSourceRef {
  readonly exportName?: string;
  readonly logicalPath: string;
  readonly moduleId: string;
  readonly name?: string;
  readonly sourceKind: AgentSourceKind;
}

export interface AgentExtensionSourceRef extends AgentSourceRef {
  readonly overrides?: AgentSourceManifest;
}

export interface AgentSourceManifest {
  readonly kind: "llm-space-agent-source-manifest";
  readonly agentId: string;
  readonly agentRoot: string;
  readonly appRoot: string;
  readonly agent?: AgentSourceRef;
  readonly channels: readonly AgentSourceRef[];
  readonly connections: readonly AgentSourceRef[];
  readonly extensions: readonly AgentExtensionSourceRef[];
  readonly hooks: readonly AgentSourceRef[];
  readonly instructions: readonly AgentSourceRef[];
  readonly instrumentation?: AgentSourceRef;
  readonly sandbox?: AgentSourceRef;
  readonly sandboxWorkspace: readonly AgentSourceRef[];
  readonly schedules: readonly AgentSourceRef[];
  readonly skills: readonly AgentSourceRef[];
  readonly subagents: readonly AgentSourceManifest[];
  readonly tools: readonly AgentSourceRef[];
}

export interface DiscoverAgentResult {
  readonly diagnostics: readonly AgentDiagnostic[];
  readonly manifest: AgentSourceManifest;
  readonly project: ResolvedAgentProject;
}

export interface AgentProjectOptions {
  readonly startPath?: string;
}

export interface DiscoverAgentOptions extends AgentProjectOptions {}

export interface AgentManifestSource {
  readonly exportName?: string;
  readonly logicalPath: string;
  readonly nodeId?: string;
  readonly sourceId: string;
  readonly sourceKind: AgentSourceKind;
}

export interface LoadedInstructionsDefinition extends AgentManifestSource {
  readonly markdown?: string;
  readonly dynamic?: boolean;
}

export interface LoadedToolDefinition extends AgentManifestSource {
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly kind?: string;
  readonly name: string;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export interface LoadedScheduleDefinition extends AgentManifestSource {
  readonly cron: string;
  readonly hasRun: boolean;
  readonly markdown?: string;
  readonly name: string;
}

export interface LoadedChannelDefinition extends AgentManifestSource {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly routes: readonly {
    readonly method: string;
    readonly path: string;
  }[];
}

export interface LoadedConnectionDefinition extends AgentManifestSource {
  readonly baseUrl?: string;
  readonly name: string;
  readonly protocol?: string;
  readonly spec?: unknown;
  readonly url?: string;
}

export interface LoadedHookDefinition extends AgentManifestSource {
  readonly eventNames: readonly string[];
  readonly name: string;
}

export interface LoadedSkillDefinition extends AgentManifestSource {
  readonly description?: string;
  readonly license?: string;
  readonly markdown?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly name: string;
}

export interface LoadedSandboxDefinition extends AgentManifestSource {
  readonly backend?: Readonly<Record<string, unknown>>;
  readonly hasBootstrap: boolean;
  readonly hasOnSession: boolean;
}

export interface LoadedInstrumentationDefinition extends AgentManifestSource {
  readonly eventNames: readonly string[];
  readonly functionId?: string;
  readonly recordInputs?: boolean;
  readonly recordOutputs?: boolean;
  readonly traceChannelRequests?: boolean;
}

export interface LoadedExtensionDefinition {
  readonly mountLogicalPath: string;
  readonly mountSourceId: string;
  readonly namespace: string;
  readonly nodeId: string;
  readonly packageName: string;
  readonly packageRoot: string;
  readonly sourceRoot: string;
}

export interface AgentManifest {
  readonly kind: "llm-space-agent-manifest";
  readonly agentId: string;
  readonly agent: Readonly<Record<string, unknown>>;
  readonly channels: readonly LoadedChannelDefinition[];
  readonly connections: readonly LoadedConnectionDefinition[];
  readonly extensions: readonly LoadedExtensionDefinition[];
  readonly hooks: readonly LoadedHookDefinition[];
  readonly instructions: readonly LoadedInstructionsDefinition[];
  readonly instrumentation?: LoadedInstrumentationDefinition;
  readonly sandbox?: LoadedSandboxDefinition;
  readonly sandboxWorkspace: readonly AgentManifestSource[];
  readonly schedules: readonly LoadedScheduleDefinition[];
  readonly skills: readonly LoadedSkillDefinition[];
  readonly tools: readonly LoadedToolDefinition[];
  readonly subagents: readonly AgentManifest[];
}

export interface AgentExecutableModuleNode {
  readonly modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface AgentExecutableModuleMap {
  readonly nodes: Readonly<Record<string, AgentExecutableModuleNode>> & {
    readonly $root: AgentExecutableModuleNode;
  };
}

export interface LoadAgentOptions extends DiscoverAgentOptions {}

export interface LoadAgentResult {
  readonly diagnostics: readonly AgentDiagnostic[];
  readonly manifest: AgentManifest;
  readonly moduleMap: AgentExecutableModuleMap;
  readonly project: ResolvedAgentProject;
  readonly sourceFingerprint: string;
}

export class AgentLoadError extends Error {
  readonly diagnostics: readonly AgentDiagnostic[];

  constructor(diagnostics: readonly AgentDiagnostic[], options?: ErrorOptions) {
    super(diagnostics.map((item) => item.message).join("\n"), options);
    this.name = "AgentLoadError";
    this.diagnostics = diagnostics;
  }
}

export class AgentProjectResolutionError extends Error {
  readonly diagnostic: AgentDiagnostic;

  constructor(diagnostic: AgentDiagnostic) {
    super(diagnostic.message);
    this.name = "AgentProjectResolutionError";
    this.diagnostic = diagnostic;
  }
}
