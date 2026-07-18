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
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadAgentProject } from "./load-agent-project";
import { assertValidAgentProject } from "../../runtime/agent/assert-valid-agent-project";
import { discoverAgentProject } from "../discover/discover-agent-project";

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

export interface AgentProjectBundle {
  readonly artifact: AgentProjectArtifact;
  readonly bundle: string;
  readonly environment: AgentEnvironmentRequirements;
}

export async function createAgentProjectBundle(
  agentRoot: string
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
    const helperPath = fileURLToPath(
      new URL("./create-bundled-agent-project.ts", import.meta.url)
    );
    const entryPath = path.join(temporaryRoot, "entry.mjs");
    await writeFile(
      entryPath,
      _entrySource(discovered, project, helperPath, dynamicInstructionSources),
      "utf8"
    );
    const bundlePath = path.join(temporaryRoot, "agent.bundle.mjs");
    await _buildInFreshBunProcess(
      entryPath,
      bundlePath,
      bundleRoot,
      helperPath,
      dynamicInstructionSources.map(source => source.absolutePath),
      discovered.tools.map(source => source.absolutePath)
    );
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

async function _buildInFreshBunProcess(
  entryPath: string,
  bundlePath: string,
  authoredRoot: string,
  helperPath: string,
  instructionEntryPaths: readonly string[],
  toolEntryPaths: readonly string[]
): Promise<void> {
  const scriptPath = `${bundlePath}.build.mjs`;
  const validatorPath = fileURLToPath(
    new URL("./validate-authored-source.ts", import.meta.url)
  );
  const dynamicToolTransformerPath = fileURLToPath(
    new URL("./transform-dynamic-tool-source.ts", import.meta.url)
  );
  await writeFile(scriptPath, `
    import path from "node:path";
    import { builtinModules } from "node:module";
    import {
      assertInstructionSourceImports,
      assertNoNonLiteralRuntimeImports
    } from ${JSON.stringify(validatorPath)};
    import { transformDynamicToolSource } from ${JSON.stringify(dynamicToolTransformerPath)};
    const [
      ENTRY_PATH,
      BUNDLE_PATH,
      RESOLVE_ROOT,
      AUTHORED_ROOT,
      HELPER_PATH,
      INSTRUCTION_ENTRY_PATHS,
      TOOL_ENTRY_PATHS
    ]
      = process.argv.slice(2);
    const AUTHORED_FILES = new Set();
    const INSTRUCTION_ENTRY_FILES = new Set(
      JSON.parse(INSTRUCTION_ENTRY_PATHS)
    );
    const INSTRUCTION_FILES = new Set(INSTRUCTION_ENTRY_FILES);
    const TOOL_ENTRY_FILES = new Set(JSON.parse(TOOL_ENTRY_PATHS));
    const RUNTIME_FILES = new Set([ENTRY_PATH, HELPER_PATH]);
    const STATE_ROOT = path.join(AUTHORED_ROOT, "state");
    const NODE_BUILTINS = new Set(
      builtinModules.map(name => name.replace(/^node:/, ""))
    );
    const BUN_COMPATIBILITY_BUILTINS = new Set(["node-fetch", "ws"]);
    const RUNTIME_SPECIFIER = /^(?:@llm-space\\/runtime(?:\\/tools|\\/connections|\\/state|\\/instructions)?|typebox)$/;
    const PLUGIN = {
      name: "llm-space-deployment-dependencies",
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          const builtin = args.path.startsWith("node:")
            || args.path.startsWith("bun:")
            || NODE_BUILTINS.has(args.path)
            || BUN_COMPATIBILITY_BUILTINS.has(args.path);
          if (builtin) { return; }
          const runtimeSpecifier = RUNTIME_SPECIFIER.test(args.path);
          const resolveFrom = runtimeSpecifier
            ? RESOLVE_ROOT
            : args.importer ? path.dirname(args.importer) : RESOLVE_ROOT;
          const resolved = Bun.resolveSync(args.path, resolveFrom);
          if (
            INSTRUCTION_FILES.has(args.importer)
            && args.path.startsWith(".")
            && !resolved.startsWith(STATE_ROOT + path.sep)
          ) {
            throw new Error("Instruction dependency escapes agent/state");
          }
          if (
            INSTRUCTION_FILES.has(args.importer)
            && resolved.startsWith(STATE_ROOT + path.sep)
          ) {
            INSTRUCTION_FILES.add(resolved);
          }
          if (args.importer === ENTRY_PATH) {
            if (resolved.startsWith(AUTHORED_ROOT + path.sep)) {
              AUTHORED_FILES.add(resolved);
            } else {
              RUNTIME_FILES.add(resolved);
            }
          } else if (
            runtimeSpecifier
            || RUNTIME_FILES.has(args.importer)
          ) {
            RUNTIME_FILES.add(resolved);
          } else if (
            AUTHORED_FILES.has(args.importer)
            || args.importer.startsWith(AUTHORED_ROOT + path.sep)
          ) {
            AUTHORED_FILES.add(resolved);
          }
          return { path: resolved };
        });
        build.onLoad({ filter: /\\.[cm]?[jt]sx?$/ }, async args => {
          if (!AUTHORED_FILES.has(args.path)) { return; }
          const source = await Bun.file(args.path).text();
          assertNoNonLiteralRuntimeImports(source, args.path);
          if (INSTRUCTION_FILES.has(args.path)) {
            assertInstructionSourceImports(source, args.path, {
              entryPaths: [...INSTRUCTION_ENTRY_FILES],
              stateRoot: STATE_ROOT
            });
          }
          const extension = path.extname(args.path);
          const loader = extension === ".tsx"
            ? "tsx"
            : extension === ".ts" || extension === ".mts" || extension === ".cts"
              ? "ts"
              : extension === ".jsx" ? "jsx" : "js";
          return {
            contents: TOOL_ENTRY_FILES.has(args.path)
              ? transformDynamicToolSource(
                source,
                path.relative(AUTHORED_ROOT, args.path).split(path.sep).join(path.posix.sep)
              )
              : source,
            loader
          };
        });
      }
    };
    const RESULT = await Bun.build({
      entrypoints: [ENTRY_PATH],
      format: "esm",
      minify: {
        identifiers: false,
        syntax: true,
        whitespace: true
      },
      sourcemap: "none",
      target: "bun",
      write: false,
      plugins: [PLUGIN]
    });
    if (!RESULT.success || !RESULT.outputs[0]) {
      throw new Error(RESULT.logs.map(log => log.message).join("\\n") || "Unable to build Agent deployment bundle");
    }
    await Bun.write(BUNDLE_PATH, RESULT.outputs[0]);
  `, "utf8");
  const child = Bun.spawn([
    process.execPath,
    scriptPath,
    entryPath,
    bundlePath,
    import.meta.dir,
    authoredRoot,
    helperPath,
    JSON.stringify(instructionEntryPaths),
    JSON.stringify(toolEntryPaths)
  ], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, standardError] = await Promise.all([
    child.exited,
    new Response(child.stderr).text()
  ]);
  if (exitCode !== 0) {
    throw new Error(
      standardError.trim() || "Unable to build Agent deployment bundle"
    );
  }
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
  const skills = (project.resources.skills ?? []).map(skill => ({
    ...skill,
    filePath: path.posix.join("skills", skill.name, "SKILL.md")
  }));
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
