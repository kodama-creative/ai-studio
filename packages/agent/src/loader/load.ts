import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import matter from "gray-matter";

import { CONNECTION_PROTOCOL_BRAND } from "../shared/types";

import { discoverAgent } from "./discovery";
import { resolveSourceExtensions } from "./source-extensions";
import type { ResolvedSourceExtension } from "./source-extensions";
import { AgentLoadError } from "./types";
import type {
  AgentExecutableModuleMap,
  AgentDiagnostic,
  AgentManifest,
  AgentManifestSource,
  AgentSourceManifest,
  AgentSourceRef,
  LoadAgentOptions,
  LoadAgentResult,
  LoadedChannelDefinition,
  LoadedConnectionDefinition,
  LoadedHookDefinition,
  LoadedInstructionsDefinition,
  LoadedInstrumentationDefinition,
  LoadedScheduleDefinition,
  LoadedSandboxDefinition,
  LoadedSkillDefinition,
  LoadedToolDefinition,
} from "./types";

const ROOT_NODE_ID = "$root";

function _logical(path: string): string {
  return path.split(sep).join("/");
}

async function _sourceFingerprint(
  roots: readonly { readonly id: string; readonly root: string }[]
): Promise<string> {
  const hash = createHash("sha256");
  for (const sourceRoot of [...roots].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const paths: string[] = [];
    async function visit(current: string): Promise<void> {
      const entries = await readdir(current, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const absolute = join(current, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) paths.push(absolute);
      }
    }
    await visit(sourceRoot.root);
    hash.update(`${sourceRoot.id.length}:${sourceRoot.id}:`);
    for (const path of paths) {
      const logicalPath = _logical(relative(sourceRoot.root, path));
      const content = await readFile(path);
      hash.update(
        `${logicalPath.length}:${logicalPath}:${content.byteLength}:`
      );
      hash.update(content);
    }
  }
  return hash.digest("hex");
}

function _moduleRefs(source: AgentSourceManifest): AgentSourceRef[] {
  return [
    ...(source.agent === undefined ? [] : [source.agent]),
    ...source.channels,
    ...source.connections,
    ...source.extensions,
    ...source.hooks,
    ...source.instructions,
    ...(source.instrumentation === undefined ? [] : [source.instrumentation]),
    ...(source.sandbox === undefined ? [] : [source.sandbox]),
    ...source.schedules,
    ...source.skills,
    ...(source.skillsVariable === undefined ? [] : [source.skillsVariable]),
    ...source.tools,
  ].filter((ref) => ref.sourceKind === "module");
}

async function _loadModuleNamespace(
  root: string,
  ref: AgentSourceRef,
  fingerprint: string
): Promise<Readonly<Record<string, unknown>>> {
  const sourcePath = join(root, ref.logicalPath);
  const url = pathToFileURL(sourcePath);
  url.searchParams.set("llm-space-generation", fingerprint);
  try {
    return (await import(url.href)) as Readonly<Record<string, unknown>>;
  } catch (cause) {
    throw new AgentLoadError(
      [
        {
          code: "load/module-import-failed",
          message: `Failed to import authored module "${ref.logicalPath}": ${_errorMessage(cause)}`,
          severity: "error",
          sourcePath,
        },
      ],
      { cause }
    );
  }
}

async function _materialize(
  root: string,
  modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  ref: AgentSourceRef
): Promise<unknown> {
  const namespace = modules[ref.moduleId];
  const value = namespace?.[ref.exportName ?? "default"];
  if (value === undefined) {
    throw new AgentLoadError([
      {
        code: "load/module-export-missing",
        message: `Authored module "${ref.logicalPath}" does not export "${ref.exportName ?? "default"}".`,
        severity: "error",
        sourcePath: join(root, ref.logicalPath),
      },
    ]);
  }
  if (typeof value !== "function") return value;
  try {
    return await (value as () => unknown)();
  } catch (cause) {
    throw new AgentLoadError(
      [
        {
          code: "load/module-factory-failed",
          message: `Failed to execute authored factory from "${ref.logicalPath}": ${_errorMessage(cause)}`,
          severity: "error",
          sourcePath: join(root, ref.logicalPath),
        },
      ],
      { cause }
    );
  }
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function _source(ref: AgentSourceRef) {
  return {
    ...(ref.exportName === undefined ? {} : { exportName: ref.exportName }),
    logicalPath: ref.logicalPath,
    sourceId: ref.moduleId,
    sourceKind: ref.sourceKind,
  };
}

function _record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function _isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function _definitionDiagnostic(
  code: string,
  message: string,
  root: string,
  ref: AgentSourceRef
) {
  return {
    code,
    message,
    severity: "error" as const,
    sourcePath: join(root, ref.logicalPath),
  };
}

function _isDynamicDefinition(
  value: Readonly<Record<string, unknown>>
): boolean {
  return value.kind === "llm-space:dynamic" && _isRecord(value.events);
}

function _isAgentDefinition(
  value: unknown,
  requireDescription: boolean
): value is Readonly<Record<string, unknown>> {
  if (!_isRecord(value)) return false;
  if (requireDescription && typeof value.description !== "string") return false;
  if (value.kind === "remote") {
    return (
      (typeof value.url === "string" || typeof value.url === "function") &&
      typeof value.path === "string"
    );
  }
  return (
    typeof value.model === "string" ||
    typeof value.model === "object" ||
    typeof value.model === "function"
  );
}

function _json(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = _json(item);
      return normalized === undefined ? [] : [normalized];
    });
  }
  if (typeof value !== "object") return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = _json(item);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function _jsonRecord(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  const normalized = _json(value);
  return typeof normalized === "object" &&
    normalized !== null &&
    !Array.isArray(normalized)
    ? (normalized as Readonly<Record<string, unknown>>)
    : undefined;
}

function _schema(
  value: unknown,
  direction: "input" | "output"
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const schema = value as Readonly<Record<string, unknown>>;
  const standard = schema["~standard"];
  if (
    typeof standard !== "object" ||
    standard === null ||
    Array.isArray(standard)
  )
    return schema;
  const jsonSchema = (standard as Readonly<Record<string, unknown>>).jsonSchema;
  if (
    typeof jsonSchema !== "object" ||
    jsonSchema === null ||
    Array.isArray(jsonSchema)
  ) {
    return {
      "x-llm-space-standard-schema": {
        direction,
        vendor:
          typeof (standard as Readonly<Record<string, unknown>>).vendor ===
          "string"
            ? (standard as Readonly<Record<string, unknown>>).vendor
            : "unknown",
        version: 1,
      },
    };
  }
  const converter = (jsonSchema as Readonly<Record<string, unknown>>)[
    direction
  ];
  if (typeof converter !== "function") {
    return {
      "x-llm-space-standard-schema": {
        direction,
        vendor:
          typeof (standard as Readonly<Record<string, unknown>>).vendor ===
          "string"
            ? (standard as Readonly<Record<string, unknown>>).vendor
            : "unknown",
        version: 1,
      },
    };
  }
  const convert = converter as (options: {
    readonly target: string;
  }) => Readonly<Record<string, unknown>>;
  return convert({ target: "draft-2020-12" });
}

async function _loadNode(
  source: AgentSourceManifest,
  fingerprint: string,
  nodeId: string,
  moduleNodes: Record<
    string,
    { modules: Record<string, Readonly<Record<string, unknown>>> }
  >,
  diagnostics: AgentDiagnostic[]
): Promise<AgentManifest> {
  const modules: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const ref of _moduleRefs(source)) {
    modules[ref.moduleId] = await _loadModuleNamespace(
      source.agentRoot,
      ref,
      fingerprint
    );
  }
  moduleNodes[nodeId] = { modules };

  const materializedAgent =
    source.agent === undefined
      ? {}
      : await _materialize(source.agentRoot, modules, source.agent);
  const requireDescription = nodeId.startsWith("subagent:");
  if (
    source.agent !== undefined &&
    !_isAgentDefinition(materializedAgent, requireDescription)
  ) {
    diagnostics.push(
      _definitionDiagnostic(
        requireDescription &&
          _isRecord(materializedAgent) &&
          typeof materializedAgent.description !== "string"
          ? "load/subagent-description-missing"
          : "load/agent-definition-invalid",
        requireDescription
          ? `Subagent "${source.agentId}" must define a description and a local model or remote URL.`
          : `Agent module "${source.agent.logicalPath}" must define a model.`,
        source.agentRoot,
        source.agent
      )
    );
  }
  const rawAgent = _record(materializedAgent);
  const agent: Record<string, unknown> = { ...(_jsonRecord(rawAgent) ?? {}) };
  if (rawAgent.outputSchema !== undefined) {
    const schema = _schema(rawAgent.outputSchema, "output");
    if (schema === undefined && source.agent !== undefined) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/schema-json-unavailable",
          `Agent outputSchema in "${source.agent.logicalPath}" must be plain JSON Schema or expose ~standard.jsonSchema.output().`,
          source.agentRoot,
          source.agent
        )
      );
    } else {
      agent.outputSchema = schema;
    }
  }

  const instructions: LoadedInstructionsDefinition[] = [];
  for (const ref of source.instructions) {
    if (ref.sourceKind === "markdown") {
      instructions.push({
        ..._source(ref),
        markdown: (
          await readFile(join(source.agentRoot, ref.logicalPath), "utf8")
        ).trim(),
      });
      continue;
    }
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    if (
      !_isRecord(value) ||
      (typeof definition.markdown !== "string" &&
        !_isDynamicDefinition(definition))
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/instructions-definition-invalid",
          `Instructions "${ref.logicalPath}" must define markdown or a dynamic event map.`,
          source.agentRoot,
          ref
        )
      );
    }
    instructions.push({
      ..._source(ref),
      ...(typeof definition.markdown === "string"
        ? { markdown: definition.markdown.trim() }
        : {}),
      ...(_isDynamicDefinition(definition) ? { dynamic: true } : {}),
    });
  }

  const channels: LoadedChannelDefinition[] = [];
  for (const ref of source.channels) {
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    const validRoutes =
      Array.isArray(definition.routes) &&
      definition.routes.every((route) => {
        const record = _record(route);
        return (
          typeof record.method === "string" &&
          typeof record.path === "string" &&
          typeof record.handler === "function"
        );
      });
    if (!_isRecord(value) || !validRoutes) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/channel-definition-invalid",
          `Channel "${ref.logicalPath}" must define a routes array of method, path, and handler entries.`,
          source.agentRoot,
          ref
        )
      );
    }
    const routes = Array.isArray(definition.routes)
      ? definition.routes.flatMap((route) => {
          const record = _record(route);
          return typeof record.method === "string" &&
            typeof record.path === "string"
            ? [{ method: record.method, path: record.path }]
            : [];
        })
      : [];
    channels.push({
      ..._source(ref),
      ...(_jsonRecord(definition.metadata) === undefined
        ? {}
        : { metadata: _jsonRecord(definition.metadata) }),
      name: ref.name ?? ref.moduleId,
      routes,
    });
  }

  const connections: LoadedConnectionDefinition[] = [];
  for (const ref of source.connections) {
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    const protocol =
      definition.protocol ??
      (_isRecord(value)
        ? (value as Readonly<Record<symbol, unknown>>)[
            CONNECTION_PROTOCOL_BRAND
          ]
        : undefined);
    const validConnection =
      typeof definition.description === "string" &&
      ((protocol === "mcp" && typeof definition.url === "string") ||
        (protocol === "openapi" && definition.spec !== undefined));
    if (!_isRecord(value) || !validConnection) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/connection-definition-invalid",
          `Connection "${ref.logicalPath}" must be a described MCP or OpenAPI definition.`,
          source.agentRoot,
          ref
        )
      );
    }
    connections.push({
      ..._source(ref),
      ...(typeof definition.baseUrl === "string"
        ? { baseUrl: definition.baseUrl }
        : {}),
      name: ref.name ?? ref.moduleId,
      ...(typeof protocol === "string" ? { protocol } : {}),
      ...(_json(definition.spec) === undefined
        ? {}
        : { spec: _json(definition.spec) }),
      ...(typeof definition.url === "string" ? { url: definition.url } : {}),
    });
  }

  const hooks: LoadedHookDefinition[] = [];
  for (const ref of source.hooks) {
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    if (
      !_isRecord(value) ||
      (definition.events !== undefined && !_isRecord(definition.events))
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/hook-definition-invalid",
          `Hook "${ref.logicalPath}" must define an events object when events are present.`,
          source.agentRoot,
          ref
        )
      );
    }
    const events = _record(definition.events);
    hooks.push({
      ..._source(ref),
      eventNames: Object.keys(events).sort(),
      name: ref.name ?? ref.moduleId,
    });
  }

  const tools: LoadedToolDefinition[] = [];
  for (const ref of source.tools) {
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    const sentinelKinds = new Set([
      "llm-space:disabled-tool",
      "llm-space:dynamic",
      "llm-space:web-search-tool",
      "llm-space:workflow-tool",
    ]);
    const sentinel =
      typeof definition.kind === "string" && sentinelKinds.has(definition.kind);
    const inputSchema = _schema(definition.inputSchema, "input");
    if (
      !_isRecord(value) ||
      (!sentinel &&
        (typeof definition.description !== "string" ||
          inputSchema === undefined ||
          typeof definition.execute !== "function")) ||
      (definition.kind === "llm-space:dynamic" && !_isRecord(definition.events))
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/tool-definition-invalid",
          `Tool "${ref.logicalPath}" must define description, a JSON-convertible inputSchema, and execute, or be a valid sentinel.`,
          source.agentRoot,
          ref
        )
      );
    }
    tools.push({
      ..._source(ref),
      ...(typeof definition.description === "string"
        ? { description: definition.description }
        : {}),
      ...(inputSchema === undefined ? {} : { inputSchema }),
      ...(typeof definition.kind === "string" ? { kind: definition.kind } : {}),
      name: ref.name ?? ref.moduleId,
      ...(_schema(definition.outputSchema, "output") === undefined
        ? {}
        : { outputSchema: _schema(definition.outputSchema, "output") }),
    });
  }

  const schedules: LoadedScheduleDefinition[] = [];
  for (const ref of source.schedules) {
    if (ref.sourceKind === "markdown") {
      const parsed = matter(
        await readFile(join(source.agentRoot, ref.logicalPath), "utf8")
      );
      const cron = typeof parsed.data.cron === "string" ? parsed.data.cron : "";
      if (cron.length === 0 || parsed.content.trim().length === 0) {
        diagnostics.push(
          _definitionDiagnostic(
            "load/schedule-definition-invalid",
            `Markdown schedule "${ref.logicalPath}" requires cron frontmatter and content.`,
            source.agentRoot,
            ref
          )
        );
      }
      schedules.push({
        ..._source(ref),
        cron,
        hasRun: false,
        markdown: parsed.content.trim(),
        name: ref.name ?? ref.moduleId,
      });
      continue;
    }
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    const hasMarkdown = typeof definition.markdown === "string";
    const hasRun = typeof definition.run === "function";
    if (
      !_isRecord(value) ||
      typeof definition.cron !== "string" ||
      definition.cron.length === 0 ||
      hasMarkdown === hasRun
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/schedule-definition-invalid",
          `Schedule "${ref.logicalPath}" requires cron and exactly one of markdown or run.`,
          source.agentRoot,
          ref
        )
      );
    }
    schedules.push({
      ..._source(ref),
      cron: typeof definition.cron === "string" ? definition.cron : "",
      hasRun: typeof definition.run === "function",
      ...(typeof definition.markdown === "string"
        ? { markdown: definition.markdown.trim() }
        : {}),
      name: ref.name ?? ref.moduleId,
    });
  }

  const skills: LoadedSkillDefinition[] = [];
  for (const ref of source.skills) {
    if (ref.sourceKind === "skill-package" || ref.sourceKind === "markdown") {
      const parsed = matter(
        await readFile(join(source.agentRoot, ref.logicalPath), "utf8")
      );
      if (
        typeof parsed.data.description !== "string" ||
        parsed.content.trim().length === 0
      ) {
        diagnostics.push(
          _definitionDiagnostic(
            "load/skill-definition-invalid",
            `Skill "${ref.logicalPath}" requires a description and Markdown content.`,
            source.agentRoot,
            ref
          )
        );
      }
      skills.push({
        ..._source(ref),
        ...(typeof parsed.data.description === "string"
          ? { description: parsed.data.description }
          : {}),
        ...(typeof parsed.data.license === "string"
          ? { license: parsed.data.license }
          : {}),
        markdown: parsed.content.trim(),
        ...(_jsonRecord(parsed.data.metadata) === undefined
          ? {}
          : {
              metadata: _jsonRecord(parsed.data.metadata) as Readonly<
                Record<string, string>
              >,
            }),
        name: ref.name ?? ref.moduleId,
      });
      continue;
    }
    const value = await _materialize(source.agentRoot, modules, ref);
    const definition = _record(value);
    if (
      !_isRecord(value) ||
      (typeof definition.description !== "string" &&
        !_isDynamicDefinition(definition)) ||
      (!_isDynamicDefinition(definition) &&
        typeof definition.markdown !== "string" &&
        typeof definition.instructions !== "string")
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/skill-definition-invalid",
          `Skill "${ref.logicalPath}" must define description and markdown, or a dynamic event map.`,
          source.agentRoot,
          ref
        )
      );
    }
    skills.push({
      ..._source(ref),
      ...(typeof definition.description === "string"
        ? { description: definition.description }
        : {}),
      ...(typeof definition.license === "string"
        ? { license: definition.license }
        : {}),
      ...(typeof definition.markdown === "string"
        ? { markdown: definition.markdown.trim() }
        : typeof definition.instructions === "string"
          ? { markdown: definition.instructions.trim() }
          : {}),
      ...(_jsonRecord(definition.metadata) === undefined
        ? {}
        : {
            metadata: _jsonRecord(definition.metadata) as Readonly<
              Record<string, string>
            >,
          }),
      name: ref.name ?? ref.moduleId,
    });
  }

  let skillsVariable: AgentManifestSource | undefined;
  if (source.skillsVariable !== undefined) {
    const value = await _materialize(
      source.agentRoot,
      modules,
      source.skillsVariable
    );
    const definition = _record(value);
    if (
      !_isRecord(value) ||
      typeof definition.name !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(definition.name) ||
      typeof definition.resolve !== "function"
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/skills-variable-definition-invalid",
          `Skills variable "${source.skillsVariable.logicalPath}" requires a valid variable name and resolve function.`,
          source.agentRoot,
          source.skillsVariable
        )
      );
    }
    skillsVariable = _source(source.skillsVariable);
  }

  let sandbox: LoadedSandboxDefinition | undefined;
  if (source.sandbox !== undefined) {
    const value = await _materialize(source.agentRoot, modules, source.sandbox);
    const definition = _record(value);
    if (!_isRecord(value)) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/sandbox-definition-invalid",
          `Sandbox "${source.sandbox.logicalPath}" must export a definition object.`,
          source.agentRoot,
          source.sandbox
        )
      );
    }
    sandbox = {
      ..._source(source.sandbox),
      ...(_jsonRecord(definition.backend) === undefined
        ? {}
        : { backend: _jsonRecord(definition.backend) }),
      hasBootstrap: typeof definition.bootstrap === "function",
      hasOnSession:
        typeof definition.onSession === "function" ||
        typeof definition.session === "function",
    };
  }

  let instrumentation: LoadedInstrumentationDefinition | undefined;
  if (source.instrumentation !== undefined) {
    const value = await _materialize(
      source.agentRoot,
      modules,
      source.instrumentation
    );
    const definition = _record(value);
    if (
      !_isRecord(value) ||
      (definition.events !== undefined && !_isRecord(definition.events)) ||
      (definition.setup !== undefined && typeof definition.setup !== "function")
    ) {
      diagnostics.push(
        _definitionDiagnostic(
          "load/instrumentation-definition-invalid",
          `Instrumentation "${source.instrumentation.logicalPath}" must export a valid definition object.`,
          source.agentRoot,
          source.instrumentation
        )
      );
    }
    instrumentation = {
      ..._source(source.instrumentation),
      eventNames: Object.keys(_record(definition.events)).sort(),
      ...(typeof definition.functionId === "string"
        ? { functionId: definition.functionId }
        : {}),
      ...(typeof definition.recordInputs === "boolean"
        ? { recordInputs: definition.recordInputs }
        : {}),
      ...(typeof definition.recordOutputs === "boolean"
        ? { recordOutputs: definition.recordOutputs }
        : {}),
      ...(typeof definition.traceChannelRequests === "boolean"
        ? { traceChannelRequests: definition.traceChannelRequests }
        : {}),
    };
  }

  const subagents: AgentManifest[] = [];
  for (const subagent of source.subagents) {
    const subagentNodeId =
      nodeId === ROOT_NODE_ID
        ? `subagent:${subagent.agentId}`
        : `${nodeId}/${subagent.agentId}`;
    subagents.push(
      await _loadNode(
        subagent,
        fingerprint,
        subagentNodeId,
        moduleNodes,
        diagnostics
      )
    );
  }

  return {
    kind: "llm-space-agent-manifest",
    agentId: source.agentId,
    agent,
    ...(source.agent === undefined
      ? {}
      : { agentSource: _source(source.agent) }),
    channels,
    connections,
    extensions: [],
    hooks,
    instructions,
    ...(instrumentation === undefined ? {} : { instrumentation }),
    ...(sandbox === undefined ? {} : { sandbox }),
    sandboxWorkspace: source.sandboxWorkspace.map(_source),
    schedules,
    skills,
    ...(skillsVariable === undefined ? {} : { skillsVariable }),
    tools,
    subagents,
  };
}

function _qualifyExtensionEntry<
  T extends { readonly name?: string; readonly sourceId: string },
>(
  entry: T,
  extension: ResolvedSourceExtension
): T & { readonly nodeId: string } {
  return {
    ...entry,
    ...(entry.name === undefined
      ? {}
      : { name: `${extension.namespace}__${entry.name}` }),
    nodeId: extension.nodeId,
    sourceId: `${extension.nodeId}:${entry.sourceId}`,
  };
}

function _applyNamedOverrides<
  TEntry extends { readonly name: string; readonly kind?: string },
>(
  entries: readonly TEntry[],
  overrides: readonly TEntry[],
  disabledKind?: string
): TEntry[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const override of overrides) {
    if (disabledKind !== undefined && override.kind === disabledKind) {
      byName.delete(override.name);
    } else {
      byName.set(override.name, override);
    }
  }
  return [...byName.values()];
}

export async function loadAgent(
  options: LoadAgentOptions = {}
): Promise<LoadAgentResult> {
  const discovered = await discoverAgent(options);
  const resolvedExtensions = await resolveSourceExtensions({
    agentRoot: discovered.project.agentRoot,
    appRoot: discovered.project.appRoot,
    mounts: discovered.manifest.extensions,
  });
  const diagnostics = [
    ...discovered.diagnostics,
    ...resolvedExtensions.diagnostics,
  ];
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new AgentLoadError(diagnostics);
  }
  const fingerprint = await _sourceFingerprint([
    { id: ROOT_NODE_ID, root: discovered.project.agentRoot },
    ...resolvedExtensions.extensions.map((extension) => ({
      id: extension.nodeId,
      root: extension.sourceRoot,
    })),
  ]);
  const nodes: Record<
    string,
    { modules: Record<string, Readonly<Record<string, unknown>>> }
  > = {};
  let manifest = await _loadNode(
    discovered.manifest,
    fingerprint,
    ROOT_NODE_ID,
    nodes,
    diagnostics
  );
  for (const extension of resolvedExtensions.extensions) {
    const extensionManifest = await _loadNode(
      extension.manifest,
      fingerprint,
      extension.nodeId,
      nodes,
      diagnostics
    );
    const qualifiedConnections = extensionManifest.connections.map((entry) =>
      _qualifyExtensionEntry(entry, extension)
    );
    const qualifiedSkills = extensionManifest.skills.map((entry) =>
      _qualifyExtensionEntry(entry, extension)
    );
    const qualifiedTools = extensionManifest.tools.map((entry) =>
      _qualifyExtensionEntry(entry, extension)
    );
    let overrideManifest: AgentManifest | undefined;
    if (extension.mount.overrides !== undefined) {
      overrideManifest = await _loadNode(
        extension.mount.overrides,
        fingerprint,
        `extension-override:${extension.namespace}`,
        nodes,
        diagnostics
      );
    }
    const overrideConnections = (overrideManifest?.connections ?? []).map(
      (entry) => _qualifyExtensionEntry(entry, extension)
    );
    const overrideSkills = (overrideManifest?.skills ?? []).map((entry) =>
      _qualifyExtensionEntry(entry, extension)
    );
    const overrideTools = (overrideManifest?.tools ?? []).map((entry) =>
      _qualifyExtensionEntry(entry, extension)
    );
    manifest = {
      ...manifest,
      connections: [
        ...manifest.connections,
        ..._applyNamedOverrides(qualifiedConnections, overrideConnections),
      ],
      extensions: [
        ...manifest.extensions,
        {
          mountLogicalPath: extension.mount.logicalPath,
          mountSourceId: extension.mount.moduleId,
          namespace: extension.namespace,
          nodeId: extension.nodeId,
          packageName: extension.packageName,
          packageRoot: extension.packageRoot,
          sourceRoot: extension.sourceRoot,
        },
      ],
      hooks: [
        ...manifest.hooks,
        ...extensionManifest.hooks.map((entry) =>
          _qualifyExtensionEntry(entry, extension)
        ),
        ...(overrideManifest?.hooks ?? []).map((entry) =>
          _qualifyExtensionEntry(entry, extension)
        ),
      ],
      instructions: [
        ...manifest.instructions,
        ...extensionManifest.instructions.map((entry) =>
          _qualifyExtensionEntry(entry, extension)
        ),
        ...(overrideManifest?.instructions ?? []).map((entry) =>
          _qualifyExtensionEntry(entry, extension)
        ),
      ],
      skills: [
        ...manifest.skills,
        ..._applyNamedOverrides(qualifiedSkills, overrideSkills),
      ],
      tools: [
        ...manifest.tools,
        ..._applyNamedOverrides(
          qualifiedTools,
          overrideTools,
          "llm-space:disabled-tool"
        ),
      ],
    };
  }
  const moduleMap: AgentExecutableModuleMap = {
    nodes: nodes as AgentExecutableModuleMap["nodes"],
  };
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new AgentLoadError(diagnostics);
  }
  return {
    diagnostics,
    manifest,
    moduleMap,
    project: discovered.project,
    sourceFingerprint: fingerprint,
  };
}
