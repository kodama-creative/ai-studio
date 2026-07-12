import {
  AgentHarness,
  type AgentHarnessEvent,
  type AgentHarnessEventResultMap,
  type AgentHarnessOwnEvent,
  type AgentTool,
  type ExecutionEnv,
  type Session,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";

import { assertValidAgentProject, type AgentProjectSnapshot } from "./project";

export interface AgentRuntimeSessionOptions {
  env: ExecutionEnv;
  models: Models;
  session: Session;
  model: Model<Api>;
  loadProject: () => Promise<AgentProjectSnapshot>;
  snapshot: AgentProjectSnapshot;
  extraTools: AgentTool[];
  instructionsPrefix: string;
  thinkingLevel?: ThinkingLevel;
  allowInvalidProject: boolean;
}

export class AgentRuntimeSession {
  private readonly _harness: AgentHarness;
  private readonly _session: Session;
  private readonly _loadProject: () => Promise<AgentProjectSnapshot>;
  private readonly _extraTools: AgentTool[];
  private readonly _instructionsPrefix: string;
  private readonly _allowInvalidProject: boolean;
  private _snapshot: AgentProjectSnapshot;

  constructor(options: AgentRuntimeSessionOptions) {
    this._session = options.session;
    this._snapshot = options.snapshot;
    this._loadProject = options.loadProject;
    this._extraTools = options.extraTools;
    this._instructionsPrefix = options.instructionsPrefix;
    this._allowInvalidProject = options.allowInvalidProject;
    this._harness = new AgentHarness({
      env: options.env,
      session: options.session,
      models: options.models,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      tools: this._allTools(options.snapshot),
      resources: options.snapshot.resources,
      systemPrompt: () => this._systemPrompt(),
    });
  }

  get project(): AgentProjectSnapshot {
    return this._snapshot;
  }

  getContext() {
    return this._session.buildContext();
  }

  getMetadata() {
    return this._session.getMetadata();
  }

  async prompt(text: string): Promise<void> {
    await this.refreshProject();
    await this._harness.prompt(text);
  }

  async skill(name: string, additionalInstructions?: string): Promise<void> {
    await this.refreshProject();
    await this._harness.skill(name, additionalInstructions);
  }

  steer(text: string): Promise<void> {
    return this._harness.steer(text);
  }

  followUp(text: string): Promise<void> {
    return this._harness.followUp(text);
  }

  nextTurn(text: string): Promise<void> {
    return this._harness.nextTurn(text);
  }

  compact(customInstructions?: string) {
    return this._harness.compact(customInstructions);
  }

  navigateTree(
    targetId: string,
    options?: Parameters<AgentHarness["navigateTree"]>[1]
  ) {
    return this._harness.navigateTree(targetId, options);
  }

  abort() {
    return this._harness.abort();
  }

  waitForIdle(): Promise<void> {
    return this._harness.waitForIdle();
  }

  subscribe(
    listener: (
      event: AgentHarnessEvent,
      signal?: AbortSignal
    ) => Promise<void> | void
  ): () => void {
    return this._harness.subscribe(listener);
  }

  on<TType extends keyof AgentHarnessEventResultMap>(
    type: TType,
    handler: (
      event: Extract<AgentHarnessOwnEvent, { type: TType }>
    ) =>
      | Promise<AgentHarnessEventResultMap[TType]>
      | AgentHarnessEventResultMap[TType]
  ): () => void {
    return this._harness.on(type, handler);
  }

  async refreshProject(): Promise<AgentProjectSnapshot> {
    const loaded = await this._loadProject();
    const snapshot = this._allowInvalidProject
      ? loaded
      : assertValidAgentProject(loaded);
    if (snapshot.fingerprint === this._snapshot.fingerprint) {
      return this._snapshot;
    }
    await this._harness.setTools(this._allTools(snapshot));
    await this._harness.setResources(snapshot.resources);
    this._snapshot = snapshot;
    return snapshot;
  }

  private _allTools(snapshot: AgentProjectSnapshot): AgentTool[] {
    const projectTools = snapshot.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error"
    )
      ? []
      : snapshot.tools;
    const tools = [...projectTools, ...this._extraTools];
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) {
        throw new Error(`Duplicate runtime tool name: ${tool.name}`);
      }
      names.add(tool.name);
    }
    return tools;
  }

  private _systemPrompt(): string {
    const diagnostics = this._snapshot.diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.severity.toUpperCase()} ${diagnostic.path}: ${diagnostic.message}`
      )
      .join("\n");
    return [
      this._instructionsPrefix.trim(),
      this._snapshot.instructions.trim(),
      diagnostics ? `Current project diagnostics:\n${diagnostics}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}
