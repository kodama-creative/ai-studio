import { rmSync } from "node:fs";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  AGENT_BUNDLE_COMPILER_SUPPORT_HELPER_SPECIFIER
} from "./agent-bundle-compiler-support";
import { generateAgentBundleCompilerSupport } from "./generate-agent-bundle-compiler-support";
import {
  loadAgentBundleCompilerSupport
} from "./load-agent-bundle-compiler-support";
import { loadAgentProject } from "./load-agent-project";
import {
  validateAgentBundleCompilerSupport
} from "./validate-agent-bundle-compiler-support";
import { assertValidAgentProject } from "../../runtime/agent/assert-valid-agent-project";
import { discoverAgentProject } from "../discover/discover-agent-project";

import type { AgentBundleCompilerSupportModule } from "./load-agent-bundle-compiler-support";
import type { AgentProjectArtifact } from "../../runtime/agent/agent-project-artifact";
import type {
  AgentEnvironmentRequirements,
  CompiledAgentDefinition
} from "../../shared/agent-definition";
import type { AgentProjectSourceRef } from "../discover/discover-agent-project";

const BUN_COMPATIBILITY_BUILTINS = new Set(["node-fetch", "ws"]);
const NODE_BUILTINS = new Set(
  builtinModules.map(name => name.replace(/^node:/, ""))
);
let sourceCompilerSupportPromise: Promise<string> | null = null;

export interface AgentProjectBundle {
  readonly artifact: AgentProjectArtifact;
  readonly bundle: string;
  readonly environment: AgentEnvironmentRequirements;
}

export interface CreateAgentProjectBundleOptions {
  readonly compilerSupportPath?: string;
}

export async function createAgentProjectBundle(
  agentRoot: string,
  options: CreateAgentProjectBundleOptions = {}
): Promise<AgentProjectBundle> {
  const temporaryRoot = await mkdtemp(path.join(
    await realpath(tmpdir()),
    "llm-space-agent-bundle-"
  ));
  try {
    const compileRoot = path.join(temporaryRoot, "compile-source");
    const bundleRoot = path.join(temporaryRoot, "bundle-source");
    await cp(agentRoot, compileRoot, { recursive: true, errorOnExist: true });
    await cp(agentRoot, bundleRoot, { recursive: true, errorOnExist: true });
    const project = await loadAgentProject(compileRoot);
    assertValidAgentProject(project);
    const discovered = await discoverAgentProject(bundleRoot);
    if (!discovered.definition) {
      throw new Error("Agent project definition is unavailable");
    }
    const dynamicInstructionSources = _dynamicInstructionSources(
      discovered,
      project
    );
    const helperPath = AGENT_BUNDLE_COMPILER_SUPPORT_HELPER_SPECIFIER;
    const entryPath = path.join(temporaryRoot, "entry.mjs");
    await writeFile(
      entryPath,
      _entrySource(discovered, project, helperPath, dynamicInstructionSources),
      "utf8"
    );
    const bundlePath = path.join(temporaryRoot, "agent.bundle.mjs");
    const compilerSupportPath = options.compilerSupportPath
      ?? await _sourceCompilerSupportPath();
    await _buildWithCompilerSupport(compilerSupportPath, {
      authoredRoot: bundleRoot,
      bundlePath,
      entryPath,
      instructionEntryPaths: dynamicInstructionSources.map(
        source => source.absolutePath
      ),
      toolEntryPaths: discovered.tools.map(source => source.absolutePath)
    });
    const bundle = await readFile(bundlePath, "utf8");
    _assertClosedBundle(bundle);
    const verificationPath = path.join(temporaryRoot, "verify.mjs");
    await writeFile(verificationPath, bundle, "utf8");
    const loaded = await import(
      pathToFileURL(verificationPath).href
    ) as {
      createAgentProject(artifact: AgentProjectArtifact): {
        artifact: AgentProjectArtifact;
        definition?: CompiledAgentDefinition;
        dynamicToolResolvers?: ReadonlyArray<{ sourcePath: string; }>;
        instructionEntries?: ReadonlyArray<{
          kind: "dynamic" | "static";
          markdown?: string;
          sourcePath: string;
        }>;
        outputDefinitions?: ReadonlyArray<{
          name: string;
          schemaFingerprint: string;
        }>;
        sandbox?: {
          sourcePath: string;
          workspace: ReadonlyArray<{
            contentBase64: string;
            fingerprint: string;
            path: string;
            size: number;
          }>;
        };
        stateDefinitions?: ReadonlyArray<{
          name: string;
          schemaFingerprint: string;
          version: number;
        }>;
        tools: ReadonlyArray<{ name: string; }>;
      };
    };
    const bundledProject = loaded.createAgentProject(project.artifact);
    if (
      JSON.stringify(bundledProject.artifact) !== JSON.stringify(project.artifact)
      || JSON.stringify(bundledProject.definition) !== JSON.stringify(project.definition)
      || JSON.stringify(bundledProject.instructionEntries?.map(entry => ({
        kind: entry.kind,
        ...(entry.kind === "static" ? { markdown: entry.markdown } : {}),
        sourcePath: entry.sourcePath
      }))) !== JSON.stringify(project.instructionEntries?.map(entry => ({
        kind: entry.kind,
        ...(entry.kind === "static" ? { markdown: entry.markdown } : {}),
        sourcePath: entry.sourcePath
      })))
      || JSON.stringify(bundledProject.stateDefinitions)
      !== JSON.stringify(project.stateDefinitions)
      || JSON.stringify(bundledProject.outputDefinitions)
      !== JSON.stringify(project.outputDefinitions)
      || JSON.stringify(bundledProject.sandbox)
      !== JSON.stringify(project.sandbox)
      || JSON.stringify(bundledProject.tools.map(tool => tool.name))
      !== JSON.stringify(project.tools.map(tool => tool.name))
      || JSON.stringify(bundledProject.dynamicToolResolvers?.map(
        resolver => resolver.sourcePath
      )) !== JSON.stringify(project.dynamicToolResolvers?.map(
        resolver => resolver.sourcePath
      ))
    ) {
      throw new Error("Bundled Agent does not match its compiled artifact");
    }
    return Object.freeze({
      artifact: project.artifact,
      bundle,
      environment: project.definition?.environment ?? {}
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function _sourceCompilerSupportPath(): Promise<string> {
  sourceCompilerSupportPromise = sourceCompilerSupportPromise
    ?? _generateSourceCompilerSupport().catch(error => {
      sourceCompilerSupportPromise = null;
      throw error;
    });
  return sourceCompilerSupportPromise;
}

async function _generateSourceCompilerSupport(): Promise<string> {
  const root = await mkdtemp(path.join(
    await realpath(tmpdir()),
    "llm-space-source-compiler-support-"
  ));
  try {
    await generateAgentBundleCompilerSupport(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  process.once("exit", () => {
    rmSync(root, { recursive: true, force: true });
  });
  return path.join(root, AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME);
}

function _assertClosedBundle(bundle: string): void {
  const external = new Bun.Transpiler({ loader: "js" })
    .scanImports(bundle)
    .map(imported => imported.path)
    .find(specifier =>
      !specifier.startsWith("node:")
      && !specifier.startsWith("bun:")
      && !NODE_BUILTINS.has(specifier)
      && !BUN_COMPATIBILITY_BUILTINS.has(specifier));
  if (external) {
    throw new Error(`Agent deployment bundle contains external import: ${external}`);
  }
}

async function _buildWithCompilerSupport(
  compilerSupportPath: string,
  input: Parameters<
    AgentBundleCompilerSupportModule["buildAgentProjectBundle"]
  >[0]
): Promise<void> {
  const validatedSupport = await validateAgentBundleCompilerSupport(
    compilerSupportPath
  );
  const compilerSupport = await loadAgentBundleCompilerSupport(
    validatedSupport
  );
  await compilerSupport.buildAgentProjectBundle(input);
}

function _entrySource(
  discovered: Awaited<ReturnType<typeof discoverAgentProject>>,
  project: Awaited<ReturnType<typeof loadAgentProject>>,
  helperPath: string,
  dynamicInstructionSources: readonly AgentProjectSourceRef[]
): string {
  const definitionPath = discovered.definition?.absolutePath;
  if (!definitionPath) { throw new Error("Agent definition is unavailable"); }
  const imports = [
    `import { createBundledAgentProject } from ${JSON.stringify(helperPath)};`,
    `import definition from ${JSON.stringify(definitionPath)};`,
    ...(discovered.sandbox?.definition
      ? [
        `import sandboxDefinition from ${JSON.stringify(discovered.sandbox.definition.absolutePath)};`
      ]
      : []),
    ...discovered.tools.map((source, index) => {
      const dynamic = project.dynamicToolResolvers?.some(
        resolver => resolver.sourcePath === source.logicalPath
      );
      return dynamic
        ? `import tool${index}, { __llmSpaceDynamicToolSteps as tool${index}Steps } from ${JSON.stringify(source.absolutePath)};`
        : `import tool${index} from ${JSON.stringify(source.absolutePath)};`;
    }),
    ...discovered.connections.map((source, index) =>
      `import connection${index} from ${JSON.stringify(source.absolutePath)};`),
    ...discovered.states.map((source, index) =>
      `import state${index} from ${JSON.stringify(source.absolutePath)};`),
    ...discovered.outputs.map((source, index) =>
      `import output${index} from ${JSON.stringify(source.absolutePath)};`),
    ...dynamicInstructionSources.map((source, index) =>
      `import dynamicInstruction${index} from ${JSON.stringify(source.absolutePath)};`)
  ];
  const tools = discovered.tools.map((source, index) => ({
    kind: project.dynamicToolResolvers?.some(
      resolver => resolver.sourcePath === source.logicalPath
    ) ? "dynamic" : "static",
    name: path.basename(source.absolutePath, path.extname(source.absolutePath)),
    sourcePath: source.logicalPath,
    definition: `tool${index}`,
    steps: `tool${index}Steps`
  }));
  const connections = discovered.connections.map((source, index) => ({
    name: path.basename(source.absolutePath, path.extname(source.absolutePath)),
    logicalPath: source.logicalPath,
    definition: `connection${index}`
  }));
  const states = discovered.states.map((source, index) => ({
    sourcePath: source.logicalPath,
    definition: `state${index}`
  }));
  const outputs = discovered.outputs.map((source, index) => ({
    name: path.basename(source.absolutePath, path.extname(source.absolutePath)),
    sourcePath: source.logicalPath,
    definition: `output${index}`
  }));
  const skills = (project.resources.skills ?? []).map(skill => ({
    ...skill,
    filePath: path.posix.join("skills", skill.name, "SKILL.md")
  }));
  const sandbox = project.sandbox
    ? `{ definition: sandboxDefinition, sourcePath: ${JSON.stringify(project.sandbox.sourcePath)}, workspace: ${JSON.stringify(project.sandbox.workspace)} }`
    : "undefined";
  let dynamicIndex = 0;
  const instructionEntries = (project.instructionEntries ?? []).map(entry =>
    (entry.kind === "static"
      ? `{ kind: "static", sourcePath: ${JSON.stringify(entry.sourcePath)}, markdown: ${JSON.stringify(entry.markdown)} }`
      : `{ kind: "dynamic", sourcePath: ${JSON.stringify(entry.sourcePath)}, definition: dynamicInstruction${dynamicIndex++} }`));
  return `${imports.join("\n")}
const INPUT = {
  definition,
  instructions: ${JSON.stringify(project.instructions)},
  instructionEntries: [${instructionEntries.join(",")}],
  tools: [${tools.map(tool => `{ kind: ${JSON.stringify(tool.kind)}, name: ${JSON.stringify(tool.name)}, sourcePath: ${JSON.stringify(tool.sourcePath)}, definition: ${tool.definition}${tool.kind === "dynamic" ? `, steps: ${tool.steps}` : ""} }`).join(",")}],
  connections: [${connections.map(connection => `{ name: ${JSON.stringify(connection.name)}, logicalPath: ${JSON.stringify(connection.logicalPath)}, definition: ${connection.definition} }`).join(",")}],
  states: [${states.map(state => `{ sourcePath: ${JSON.stringify(state.sourcePath)}, definition: ${state.definition} }`).join(",")}],
  outputs: [${outputs.map(output => `{ name: ${JSON.stringify(output.name)}, sourcePath: ${JSON.stringify(output.sourcePath)}, definition: ${output.definition} }`).join(",")}],
  sandbox: ${sandbox},
  skills: ${JSON.stringify(skills)}
};
const EXPECTED_ARTIFACT = Object.freeze(${JSON.stringify(project.artifact)});
export const createAgentProject = artifact => {
  if (JSON.stringify(artifact) !== JSON.stringify(EXPECTED_ARTIFACT)) {
    throw new Error("Bundled Agent artifact descriptor mismatch");
  }
  return createBundledAgentProject(INPUT, artifact);
};
`;
}

function _dynamicInstructionSources(
  discovered: Awaited<ReturnType<typeof discoverAgentProject>>,
  project: Awaited<ReturnType<typeof loadAgentProject>>
): readonly AgentProjectSourceRef[] {
  return (project.instructionEntries ?? [])
    .filter(entry => entry.kind === "dynamic")
    .map(entry => {
      const source = discovered.instructionEntries.find(candidate =>
        candidate.logicalPath === entry.sourcePath);
      if (!source) {
        throw new Error(
          `Dynamic instruction source is unavailable: ${entry.sourcePath}`
        );
      }
      return source;
    });
}
