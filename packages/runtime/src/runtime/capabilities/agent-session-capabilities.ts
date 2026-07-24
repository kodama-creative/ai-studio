import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import { isToolDefinition } from "../../public/definitions/tool";
import { isAgentToolName } from "../../shared/is-agent-tool-name";
import { createCompiledProjectTool } from "../agent/create-compiled-project-tool";
import { prepareProjectTool } from "../agent/prepare-project-tool";
import { deriveCapabilitySnapshotFingerprint } from "../harness/derive-capability-snapshot-fingerprint";
import { sha256 } from "../harness/sha256";

import type {
  DynamicToolRuntimeMetadata,
  DynamicToolStep
} from "../../internal/dynamic-tool-step";
import type { ToolDefinition } from "../../public/definitions/tool";
import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type {
  AgentDynamicModelSelection,
  AgentModelDefinition,
  AgentModelOptionsDefinition,
  AgentModelSelector,
  CompiledAgentDefinition
} from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";
import type {
  RuntimeSessionStateValue,
  RuntimeTurnCapabilitySnapshot,
  StoredRuntimeSession
} from "../harness/session-store";
import type { AgentSessionState } from "../state/agent-session-state";

export interface AgentCapabilityRequest {
  readonly activeToolNames?: readonly string[];
  readonly model?: AgentModelSelector;
  readonly modelConfigurationAuthority?: "agent" | "host";
  readonly modelOptions?: AgentModelOptionsDefinition;
  readonly reasoning?: ThinkingLevel;
}

export interface ResolvedAgentCapabilities {
  readonly model: AgentModelSelector;
  readonly modelOptions: AgentModelOptionsDefinition;
  readonly reasoning?: ThinkingLevel;
  readonly snapshot: RuntimeTurnCapabilitySnapshot;
  readonly tools: PreparedAgentTool[];
}

export class AgentHostPolicyChangedError extends Error {
  constructor() {
    super("The Host capability policy changed after this Turn was recorded");
    this.name = "AgentHostPolicyChangedError";
  }
}

export class AgentSessionCapabilities {
  private readonly _context: AgentSessionContext;
  private readonly _definition: CompiledAgentDefinition;
  private readonly _models: Models;
  private readonly _policy: AgentCapabilityPolicy;
  private readonly _project: AgentProjectSnapshot;
  private readonly _request: AgentCapabilityRequest;
  private readonly _sessionStoreAvailable: boolean;
  private readonly _sessionState: AgentSessionState;
  private readonly _tools: PreparedAgentTool[];

  constructor(input: {
    context: AgentSessionContext;
    models: Models;
    policy: AgentCapabilityPolicy;
    project: AgentProjectSnapshot;
    request: AgentCapabilityRequest;
    sessionState: AgentSessionState;
    sessionStoreAvailable: boolean;
    tools: PreparedAgentTool[];
  }) {
    const definition = input.project.definition;
    if (!definition) { throw new Error("Agent runtime definition is unavailable"); }
    this._context = input.context;
    this._definition = definition;
    this._models = input.models;
    this._policy = structuredClone(input.policy);
    this._project = input.project;
    this._request = input.request;
    this._sessionStoreAvailable = input.sessionStoreAvailable;
    this._sessionState = input.sessionState;
    this._tools = input.tools;
  }

  async prepare(
    stateScopeEnabled: boolean,
    stored: StoredRuntimeSession | null
  ): Promise<ResolvedAgentCapabilities> {
    if (
      !this._sessionStoreAvailable
      && (
        this._definition.dynamicModel
        || (this._project.dynamicToolResolvers?.length ?? 0) > 0
      )
    ) {
      throw new Error(
        "Agent Projects with dynamic capabilities require a Session Store"
      );
    }
    const hostPolicyFingerprint = await _fingerprint(this._policy);
    const requestFingerprint = await _fingerprint(this._request);
    const existing = stored?.snapshot.capabilitySnapshots?.[
      this._context.turn.id
    ];
    if (existing) {
      if (existing.agentSnapshotFingerprint !== this._project.fingerprint) {
        throw new Error(
          `Turn ${this._context.turn.id} capability snapshot belongs to a different Agent artifact`
        );
      }
      if (existing.hostPolicyFingerprint !== hostPolicyFingerprint) {
        throw new AgentHostPolicyChangedError();
      }
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new Error(
          "The Turn capability request changed after its snapshot was recorded"
        );
      }
      return {
        model: existing.model,
        modelOptions: existing.modelOptions,
        reasoning: existing.reasoning,
        snapshot: existing,
        tools: this._rehydrateTools(existing)
      };
    }

    const selection = await this._resolveModel(stateScopeEnabled);
    _assertRequestWithinAuthoredCapabilities(
      this._definition,
      this._request,
      selection
    );
    const model = this._request.model ?? _selectionModel(selection);
    _assertModelAllowed(model, this._policy);
    if (!this._models.getModel(model.provider, model.id)) {
      throw new Error(`Selected model is unavailable: ${model.provider}/${model.id}`);
    }
    const modelOptions = {
      ...(this._definition.modelOptions ?? {}),
      ...(_selectionOptions(selection) ?? {}),
      ...(this._request.modelOptions ?? {})
    };
    const reasoning = Object.hasOwn(this._request, "reasoning")
      ? this._request.reasoning
      : _normalizeReasoning(modelOptions.reasoning)
        ?? this._definition.reasoning;
    const normalizedOptions = { ...modelOptions };
    delete (normalizedOptions as { reasoning?: unknown; }).reasoning;
    _assertReasoningAllowed(reasoning, this._policy);
    _assertModelOptionsAllowed(normalizedOptions, this._policy);

    const tools = await this._resolveTools(stateScopeEnabled);
    const toolSnapshots = await Promise.all(tools.map(async tool => {
      const inputSchema = structuredClone(
        tool.definition.parameters
      ) as RuntimeSessionStateValue;
      const outputSchema = "outputSchema" in tool.definition
        ? structuredClone(
          tool.definition.outputSchema
        ) as RuntimeSessionStateValue | undefined
        : undefined;
      const runtimeMetadata = (tool as {
        runtimeMetadata?: DynamicToolRuntimeMetadata;
      } & PreparedAgentTool).runtimeMetadata;
      return {
        ...(tool.kind === "executable"
          && tool.approval
          && typeof tool.approval !== "function"
          ? { approval: tool.approval }
          : {}),
        contributionId: tool.provenance?.contributionId
          ?? `host-tool:${tool.definition.name}`,
        description: tool.definition.description,
        ...(tool.executionEnvToolKind
          ? {
            executionEnvToolKind: tool.executionEnvToolKind,
            requiresExecutionEnv: true as const
          }
          : {}),
        inputSchema,
        name: tool.definition.name,
        ...(outputSchema === undefined ? {} : { outputSchema }),
        schemaFingerprint: tool.provenance?.schemaFingerprint
          ?? await _fingerprint([
            tool.definition.name,
            tool.definition.description,
            inputSchema,
            outputSchema ?? null
          ]),
        ...(tool.provenance?.sourcePath
          ? { sourcePath: tool.provenance.sourcePath }
          : {}),
        ...(runtimeMetadata
          ? {
            stepId: runtimeMetadata.stepId,
            closureVariables: runtimeMetadata.closureVariables
          }
          : {})
      };
    }));
    const connectionTools = toolSnapshots.flatMap(tool => {
      const prepared = tools.find(candidate => candidate.definition.name === tool.name);
      const connectionName = prepared?.provenance?.connectionName;
      return connectionName ? [{
        connectionName,
        contributionId: tool.contributionId,
        schemaFingerprint: tool.schemaFingerprint,
        toolName: tool.name
      }] : [];
    });
    const content = {
      agentSnapshotFingerprint: this._project.fingerprint,
      connectionTools,
      hostPolicyFingerprint,
      model,
      modelOptions: normalizedOptions,
      ...(reasoning === undefined ? {} : { reasoning }),
      requestFingerprint,
      tools: toolSnapshots,
      turnId: this._context.turn.id
    };
    const snapshot: RuntimeTurnCapabilitySnapshot = {
      ...content,
      fingerprint: await deriveCapabilitySnapshotFingerprint(content)
    };
    return { model, modelOptions: normalizedOptions, reasoning, snapshot, tools };
  }

  private async _resolveModel(
    stateScopeEnabled: boolean
  ): Promise<AgentDynamicModelSelection> {
    const dynamic = this._definition.dynamicModel;
    if (!dynamic) { return _selectorString(this._definition.model); }
    const resolve = async () => dynamic.events["turn.started"](
      { type: "turn.started" },
      { session: this._context }
    );
    try {
      const result = stateScopeEnabled
        ? await this._sessionState.executeReadOnly(resolve)
        : await resolve();
      return result ?? dynamic.fallback;
    } catch {
      return dynamic.fallback;
    }
  }

  private async _resolveTools(
    stateScopeEnabled: boolean
  ): Promise<PreparedAgentTool[]> {
    const activeNames = this._request.activeToolNames
      ? new Set(this._request.activeToolNames)
      : null;
    const selected = new Map<string, PreparedAgentTool>();
    for (const tool of this._tools) {
      const contributionId = tool.provenance?.contributionId
        ?? `host-tool:${tool.definition.name}`;
      const isConnection = Boolean(tool.provenance?.connectionName);
      const contributions = isConnection
        ? this._policy.connectionContributions
        : this._policy.toolContributions;
      if (!contributions.includes(contributionId)) {
        if (activeNames?.has(tool.definition.name)) {
          throw new Error(`Host policy denies tool: ${tool.definition.name}`);
        }
        continue;
      }
      if (!activeNames || activeNames.has(tool.definition.name)) {
        selected.set(tool.definition.name, tool);
      }
    }

    const resolvers = (this._project.dynamicToolResolvers ?? []).filter(
      resolver => this._policy.toolContributions.includes(
        resolver.contributionId
      )
    );
    const outcomes = await Promise.allSettled(resolvers.map(async resolver => {
      const resolve = async () => resolver.definition.events["turn.started"](
        { type: "turn.started" },
        { session: this._context }
      );
      const result = stateScopeEnabled
        ? await this._sessionState.executeReadOnly(resolve)
        : await resolve();
      return { resolver, result };
    }));
    const dynamicOwners = new Map<string, string>();
    for (const outcome of outcomes) {
      if (outcome.status === "rejected" || outcome.value.result === null) {
        continue;
      }
      const { resolver, result } = outcome.value;
      const definitions = isToolDefinition(result)
        ? [[_sourceSlug(resolver.sourcePath), result] as const]
        : Object.entries(result);
      for (const [name, definition] of definitions) {
        if (!isAgentToolName(name)) {
          throw new TypeError(`Invalid dynamic tool name: ${name}`);
        }
        if (!isToolDefinition(definition)) {
          throw new TypeError(
            `Dynamic tool resolver ${resolver.sourcePath} returned an invalid tool`
          );
        }
        const previous = dynamicOwners.get(name);
        if (previous && previous !== resolver.contributionId) {
          throw new Error(
            `Dynamic tool ${name} collides between ${previous} and ${resolver.contributionId}`
          );
        }
        dynamicOwners.set(name, resolver.contributionId);
        const dynamicTool = _prepareDynamicTool({
          contributionId: resolver.contributionId,
          definition,
          name,
          session: this._context,
          sourcePath: resolver.sourcePath
        });
        selected.set(name, dynamicTool.kind === "executable"
          ? {
            ...dynamicTool,
            execute: async (...args) => this._sessionState.executeTool(
              async () => dynamicTool.execute(...args)
            )
          }
          : dynamicTool);
      }
    }
    return [...selected.values()].sort((left, right) =>
      (left.definition.name < right.definition.name ? -1 : 1));
  }

  private _rehydrateTools(
    snapshot: RuntimeTurnCapabilitySnapshot
  ): PreparedAgentTool[] {
    const candidates = new Map(this._tools.map(tool => [
      `${tool.provenance?.contributionId ?? `host-tool:${tool.definition.name}`}:${tool.definition.name}`,
      tool
    ]));
    return snapshot.tools.map(tool => {
      const existing = candidates.get(`${tool.contributionId}:${tool.name}`);
      if (existing) { return existing; }
      if (!tool.stepId || !tool.closureVariables) {
        throw new Error(`Dynamic tool ${tool.name} cannot be reconstructed`);
      }
      const step = this._project.dynamicToolResolvers
        ?.find(resolver => resolver.contributionId === tool.contributionId)
        ?.steps[tool.stepId];
      if (!step) {
        throw new Error(`Dynamic tool step is unavailable: ${tool.stepId}`);
      }
      const prepared = _preparedToolFromSnapshot(tool, step, this._context);
      return prepared.kind === "executable"
        ? {
          ...prepared,
          execute: async (...args) => this._sessionState.executeTool(
            async () => prepared.execute(...args)
          )
        }
        : prepared;
    });
  }
}

function _prepareDynamicTool(input: {
  contributionId: string;
  definition: ToolDefinition;
  name: string;
  session: AgentSessionContext;
  sourcePath: string;
}): PreparedAgentTool {
  if (typeof input.definition.approval === "function") {
    throw new TypeError(
      `Dynamic tool ${input.name} approval policy must be a static requirement`
    );
  }
  const metadata = (input.definition as {
    __llmSpaceDynamicTool?: DynamicToolRuntimeMetadata;
  } & ToolDefinition).__llmSpaceDynamicTool;
  if (!metadata) {
    throw new TypeError(
      `Dynamic tool ${input.name} execute must be an inline function`
    );
  }
  const prepared = prepareProjectTool(createCompiledProjectTool({
    definition: input.definition,
    getSession: () => input.session,
    name: input.name,
    sourcePath: input.sourcePath
  }), {
    contributionId: input.contributionId,
    sourcePath: input.sourcePath
  });
  return {
    ...prepared,
    runtimeMetadata: metadata
  } as unknown as PreparedAgentTool;
}

function _preparedToolFromSnapshot(
  tool: RuntimeTurnCapabilitySnapshot["tools"][number],
  step: DynamicToolStep,
  session: AgentSessionContext
): PreparedAgentTool {
  const definition = {
    description: tool.description,
    inputSchema: tool.inputSchema as ToolDefinition["inputSchema"],
    ...(tool.approval ? { approval: tool.approval } : {}),
    ...(tool.outputSchema
      ? { outputSchema: tool.outputSchema }
      : {}),
    execute: async (value: unknown, context: Parameters<ToolDefinition["execute"]>[1]) =>
      step(
        tool.closureVariables as unknown as Record<string, never>,
        value,
        context
      )
  } as ToolDefinition;
  return prepareProjectTool(createCompiledProjectTool({
    definition,
    getSession: () => session,
    name: tool.name,
    ...(tool.sourcePath ? { sourcePath: tool.sourcePath } : {})
  }), {
    contributionId: tool.contributionId,
    ...(tool.sourcePath ? { sourcePath: tool.sourcePath } : {})
  });
}

function _selectionModel(selection: AgentDynamicModelSelection): AgentModelSelector {
  const value = typeof selection === "string" ? selection : selection.model;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new TypeError(`Invalid dynamic model selection: ${value}`);
  }
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

function _selectionOptions(
  selection: AgentDynamicModelSelection
): AgentModelOptionsDefinition | undefined {
  return typeof selection === "string" ? undefined : selection.modelOptions;
}

function _selectorString(selector: AgentModelSelector): AgentModelDefinition {
  return `${selector.provider}/${selector.id}`;
}

function _normalizeReasoning(
  value: AgentModelOptionsDefinition["reasoning"]
): ThinkingLevel | undefined {
  if (value === "provider-default") { return undefined; }
  return value === "none" ? "off" : value;
}

function _assertModelAllowed(
  model: AgentModelSelector,
  policy: AgentCapabilityPolicy
): void {
  if (!policy.models.some(candidate =>
    candidate.provider === model.provider && candidate.id === model.id)) {
    throw new Error(`Host policy denies model: ${model.provider}/${model.id}`);
  }
}

function _assertReasoningAllowed(
  reasoning: ThinkingLevel | undefined,
  policy: AgentCapabilityPolicy
): void {
  if (reasoning !== undefined && !policy.reasoning.includes(reasoning)) {
    throw new Error(`Host policy denies reasoning: ${reasoning}`);
  }
}

function _assertModelOptionsAllowed(
  options: AgentModelOptionsDefinition,
  policy: AgentCapabilityPolicy
): void {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) { continue; }
    _assertIntrinsicModelOption(key, value);
    const bound = policy.modelOptions[key as keyof typeof policy.modelOptions];
    if (bound === undefined) {
      throw new Error(`Host policy denies model option: ${key}`);
    }
    if (!("min" in bound)) {
      if (!bound.includes(value as never)) {
        throw new Error(`Host policy denies model option value: ${key}`);
      }
      continue;
    }
    if (key === "thinkingBudgets") {
      for (const budget of Object.values(value as Record<string, number>)) {
        _assertRange(key, budget, bound);
      }
      continue;
    }
    _assertRange(key, value as number, bound);
  }
}

function _assertIntrinsicModelOption(key: string, value: unknown): void {
  if (key === "thinkingBudgets") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid model option value: ${key}`);
    }
    for (const [level, budget] of Object.entries(value)) {
      if (
        !["minimal", "low", "medium", "high"].includes(level)
        || !Number.isSafeInteger(budget)
        || (budget as number) < 0
      ) {
        throw new Error(`Invalid model option value: ${key}`);
      }
    }
    return;
  }
  if (key === "temperature") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
      throw new Error(`Invalid model option value: ${key}`);
    }
    return;
  }
  if ([
    "maxRetries",
    "maxRetryDelayMs",
    "maxTokens",
    "timeoutMs",
    "websocketConnectTimeoutMs"
  ].includes(key)) {
    const minimum = key === "maxTokens" ? 1 : 0;
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
      throw new Error(`Invalid model option value: ${key}`);
    }
  }
}

function _assertRequestWithinAuthoredCapabilities(
  definition: CompiledAgentDefinition,
  request: AgentCapabilityRequest,
  selection: AgentDynamicModelSelection
): void {
  if (request.modelConfigurationAuthority === "host") {
    return;
  }
  if (request.model) {
    const authoredModels = [
      definition.model,
      _selectionModel(selection)
    ];
    if (!authoredModels.some(model =>
      model.provider === request.model?.provider
      && model.id === request.model.id)) {
      throw new Error(
        `Agent source denies model request: ${request.model.provider}/${request.model.id}`
      );
    }
  }
  if (Object.hasOwn(request, "reasoning")) {
    const authoredReasoning: Array<ThinkingLevel | undefined> = [
      definition.reasoning
    ];
    const selectionOptions = _selectionOptions(selection);
    if (selectionOptions && Object.hasOwn(selectionOptions, "reasoning")) {
      authoredReasoning.push(_normalizeReasoning(selectionOptions.reasoning));
    }
    if (!authoredReasoning.includes(request.reasoning)) {
      throw new Error(`Agent source denies reasoning request: ${String(request.reasoning)}`);
    }
  }
  const requestedOptions = request.modelOptions ?? {};
  const authoredOptions = {
    ...(definition.modelOptions ?? {}),
    ...(_selectionOptions(selection) ?? {})
  };
  for (const key of Object.keys(requestedOptions)) {
    if (!Object.hasOwn(authoredOptions, key)) {
      throw new Error(`Agent source denies model option request: ${key}`);
    }
  }
}

function _assertRange(
  key: string,
  value: number,
  range: { max: number; min: number; }
): void {
  if (!Number.isFinite(value) || value < range.min || value > range.max) {
    throw new Error(`Host policy denies model option value: ${key}`);
  }
}

async function _fingerprint(value: unknown): Promise<string> {
  return sha256(JSON.stringify(value));
}

function _sourceSlug(sourcePath: string): string {
  return sourcePath.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? sourcePath;
}
