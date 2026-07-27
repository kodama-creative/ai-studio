import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import rootPackage from "../../../../../package.json" with { type: "json" };
import runtimePackage from "../../../package.json" with { type: "json" };
import {
  AGENT_PROJECT_ARTIFACT_SCHEMA_VERSION,
  type AgentProjectArtifact,
  type AgentProjectArtifactFingerprintEntry,
  type AgentProjectArtifactFingerprintSection
} from "../../runtime/agent/agent-project-artifact";

import type {
  CompiledAgentInstructionEntry,
  CompiledAgentOutputDefinition,
  CompiledAgentSkill,
  CompiledAgentStateDefinition,
  CompiledAgentSubagent,
  CompiledDynamicToolResolver,
  CompiledMcpConnection,
  CompiledProjectTool,
  CompiledSandboxRequirement
} from "../../runtime/agent/agent-project-snapshot";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";

const RUNTIME_DEPENDENCIES = [
  {
    name: "@earendil-works/pi-agent-core",
    specifier: "@earendil-works/pi-agent-core"
  },
  { name: "@earendil-works/pi-ai", specifier: "@earendil-works/pi-ai" },
  {
    name: "@modelcontextprotocol/sdk",
    specifier: "@modelcontextprotocol/sdk/client/index.js"
  },
  { name: "typescript", specifier: "typescript" },
  { name: "typebox", specifier: "typebox" }
] as const;

export interface AgentProjectArtifactDependencyInput {
  readonly fingerprint: string;
  readonly id: string;
}

export interface AgentProjectArtifactSourceInput {
  readonly content: string;
  readonly id: string;
}

const RUNTIME_FINGERPRINT_INPUTS = await _runtimeFingerprintInputs();

export function createAgentProjectArtifact({
  connections,
  definition,
  dependencies,
  dynamicToolResolvers = [],
  instructions,
  instructionEntries = [],
  skills,
  stateDefinitions = [],
  outputDefinitions = [],
  sandbox,
  sources,
  subagents = [],
  tools
}: {
  connections: readonly CompiledMcpConnection[];
  definition: CompiledAgentDefinition | undefined;
  dependencies: readonly AgentProjectArtifactDependencyInput[];
  dynamicToolResolvers?: readonly CompiledDynamicToolResolver[];
  instructionEntries?: readonly CompiledAgentInstructionEntry[];
  instructions: string;
  outputDefinitions?: readonly CompiledAgentOutputDefinition[];
  sandbox?: CompiledSandboxRequirement;
  skills: readonly CompiledAgentSkill[];
  sources: readonly AgentProjectArtifactSourceInput[];
  stateDefinitions?: readonly CompiledAgentStateDefinition[];
  subagents?: readonly CompiledAgentSubagent[];
  tools: readonly CompiledProjectTool[];
}): AgentProjectArtifact {
  const fingerprints = {
    sources: _section(sources),
    dependencies: _section(
      dependencies.map(dependency => ({
        id: dependency.id,
        content: dependency.fingerprint
      }))
    ),
    capabilities: _section([
      ...(definition ? [{
        id: "agent",
        content: {
          description: definition.description ?? null,
          model: definition.model,
          modelOptions: definition.modelOptions ?? null,
          limits: definition.limits ?? null,
          reasoning: definition.reasoning ?? null,
          environment: definition.environment ?? null,
          dynamicModel: definition.dynamicModel
            ? { fallback: definition.model, events: ["turn.started"] }
            : null
        }
      }] : []),
      ...(sandbox ? [{
        id: "sandbox",
        content: {
          revalidationFingerprint: sandbox.revalidationFingerprint,
          sourcePath: sandbox.sourcePath,
          workspace: sandbox.workspace.map(file => ({
            path: file.path,
            size: file.size,
            fingerprint: file.fingerprint
          }))
        }
      }] : []),
      { id: "instructions", content: instructions },
      ...instructionEntries.map(entry => ({
        id: `instruction:${entry.sourcePath}`,
        content: entry.kind === "static"
          ? { kind: entry.kind, markdown: entry.markdown }
          : { kind: entry.kind, events: ["turn.started"] }
      })),
      ...tools.map(tool => ({
        id: `tool:${tool.name}`,
        content: {
          name: tool.name,
          description: tool.description,
          executionEnvToolKind: tool.executionEnvToolKind ?? null,
          requiresExecutionEnv: tool.requiresExecutionEnv ?? false
        }
      })),
      ...dynamicToolResolvers.map(resolver => ({
        id: resolver.contributionId,
        content: {
          sourcePath: resolver.sourcePath,
          events: ["turn.started"]
        }
      })),
      ...connections.map(connection => ({
        id: `connection:${connection.name}`,
        content: {
          name: connection.name,
          description: connection.definition.description,
          transport: connection.definition.transport,
          url: connection.definition.url,
          tools: connection.definition.tools.allow
        }
      })),
      ...skills.map(skill => ({
        id: `skill:${skill.name}`,
        content: {
          name: skill.name,
          description: skill.description,
          content: skill.content,
          disableModelInvocation: skill.disableModelInvocation ?? false
        }
      })),
      ...stateDefinitions.map(state => ({
        id: `state:${state.name}`,
        content: {
          name: state.name,
          version: state.version,
          initial: state.initial
        }
      })),
      ...outputDefinitions.map(output => ({
        id: `output:${output.name}`,
        content: {
          name: output.name,
          description: output.description
        }
      })),
      ...subagents.map(subagent => ({
        id: `subagent:${subagent.id}`,
        content: {
          id: subagent.id,
          description: subagent.description,
          artifactFingerprint: subagent.project.artifact.fingerprint
        }
      }))
    ]),
    schemas: _section([
      ...tools.flatMap(tool => [
        {
          id: `tool:${tool.name}:input`,
          content: tool.parameters
        },
        {
          id: `tool:${tool.name}:output`,
          content: tool.outputSchema ?? null
        }
      ]),
      ...stateDefinitions.map(state => ({
        id: `state:${state.name}`,
        content: {
          version: state.version,
          schema: state.schema,
          schemaFingerprint: state.schemaFingerprint
        }
      })),
      ...outputDefinitions.map(output => ({
        id: `output:${output.name}`,
        content: {
          schema: output.schema,
          schemaFingerprint: output.schemaFingerprint
        }
      }))
    ]),
    runtime: _section(RUNTIME_FINGERPRINT_INPUTS),
    environmentRequirements: _section([
      ...Object.entries(definition?.environment ?? {}).map(
        ([name, requirement]) => ({
          id: `agent-env:${name}`,
          content: requirement
        })
      ),
      {
        id: `bun@${rootPackage.engines.bun}`,
        content: { runtime: "bun", requirement: rootPackage.engines.bun }
      }
    ])
  };
  return {
    schemaVersion: AGENT_PROJECT_ARTIFACT_SCHEMA_VERSION,
    fingerprint: _fingerprint({
      schemaVersion: AGENT_PROJECT_ARTIFACT_SCHEMA_VERSION,
      fingerprints
    }),
    fingerprints
  };
}

interface ArtifactContentInput {
  readonly content: unknown;
  readonly id: string;
}

async function _runtimeFingerprintInputs(): Promise<ArtifactContentInput[]> {
  const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const dependencyVersions = await Promise.all(
    RUNTIME_DEPENDENCIES.map(async dependency => ({
      name: dependency.name,
      version: await _resolvedPackageVersion(
        dependency.name,
        dependency.specifier
      )
    }))
  );
  return [
    {
      id: `bun-compiler@${Bun.version}`,
      content: { compiler: "bun", version: Bun.version }
    },
    {
      id: `${runtimePackage.name}@${runtimePackage.version}`,
      content: {
        artifactSchemaVersion: AGENT_PROJECT_ARTIFACT_SCHEMA_VERSION,
        package: runtimePackage.name,
        version: runtimePackage.version
      }
    },
    ...dependencyVersions.map(dependency => ({
      id: `${dependency.name}@${dependency.version}`,
      content: dependency
    })),
    ...(await _runtimeSourceInputs(sourceRoot, sourceRoot))
  ];
}

async function _resolvedPackageVersion(
  name: string,
  specifier: string
): Promise<string> {
  let directory = path.dirname(
    Bun.resolveSync(specifier, fileURLToPath(new URL(".", import.meta.url)))
  );
  while (true) {
    try {
      const packageValue = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8")
      ) as unknown;
      if (
        packageValue
        && typeof packageValue === "object"
        && "name" in packageValue
        && packageValue.name === name
        && "version" in packageValue
        && typeof packageValue.version === "string"
      ) {
        return packageValue.version;
      }
    } catch (error) {
      if (!_hasCode(error, "ENOENT")) { throw error; }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`Unable to resolve package version for ${name}`);
    }
    directory = parent;
  }
}

async function _runtimeSourceInputs(
  directory: string,
  sourceRoot: string
): Promise<ArtifactContentInput[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const inputs: ArtifactContentInput[] = [];
  for (const entry of entries.sort((left, right) =>
    _compareCodePoint(left.name, right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      inputs.push(...(await _runtimeSourceInputs(absolutePath, sourceRoot)));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      inputs.push({
        id: `runtime-source:${path.relative(sourceRoot, absolutePath)
          .split(path.sep)
          .join(path.posix.sep)}`,
        content: await readFile(absolutePath, "utf8")
      });
    }
  }
  return inputs;
}

function _section(
  inputs: readonly ArtifactContentInput[]
): AgentProjectArtifactFingerprintSection {
  const entries = inputs
    .map(input => ({
      id: input.id,
      fingerprint: _fingerprint(input.content)
    }))
    .sort((left, right) => _compareCodePoint(left.id, right.id));
  _assertUniqueEntryIds(entries);
  return {
    fingerprint: _fingerprint(entries),
    entries
  };
}

function _assertUniqueEntryIds(
  entries: readonly AgentProjectArtifactFingerprintEntry[]
): void {
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry && entries[index - 1]?.id === entry.id) {
      throw new TypeError(
        `Duplicate Agent artifact fingerprint entry: ${entry.id}`
      );
    }
  }
}

function _fingerprint(value: unknown): string {
  return createHash("sha256").update(_canonicalJson(value)).digest("hex");
}

function _canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Agent artifact fingerprint input must be finite JSON");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(_compareCodePoint)
      .map(key => `${JSON.stringify(key)}:${_canonicalJson(
        (value as Record<string, unknown>)[key]
      )}`)
      .join(",")}}`;
  }
  throw new TypeError("Agent artifact fingerprint input must be JSON data");
}

function _compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
