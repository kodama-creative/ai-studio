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
    const helperPath = fileURLToPath(
      new URL("./create-bundled-agent-project.ts", import.meta.url)
    );
    const entryPath = path.join(temporaryRoot, "entry.mjs");
    await writeFile(
      entryPath,
      _entrySource(discovered, project, helperPath),
      "utf8"
    );
    const bundlePath = path.join(temporaryRoot, "agent.bundle.mjs");
    await _buildInFreshBunProcess(
      entryPath,
      bundlePath,
      bundleRoot,
      helperPath
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
        tools: ReadonlyArray<{ name: string; }>;
      };
    };
    const bundledProject = loaded.createAgentProject(project.artifact);
    if (
      JSON.stringify(bundledProject.artifact) !== JSON.stringify(project.artifact)
      || JSON.stringify(bundledProject.definition) !== JSON.stringify(project.definition)
      || JSON.stringify(bundledProject.tools.map(tool => tool.name))
      !== JSON.stringify(project.tools.map(tool => tool.name))
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
  helperPath: string
): Promise<void> {
  const scriptPath = `${bundlePath}.build.mjs`;
  const validatorPath = fileURLToPath(
    new URL("./validate-authored-source.ts", import.meta.url)
  );
  await writeFile(scriptPath, `
    import path from "node:path";
    import { builtinModules } from "node:module";
    import { assertNoNonLiteralRuntimeImports } from ${JSON.stringify(validatorPath)};
    const [ENTRY_PATH, BUNDLE_PATH, RESOLVE_ROOT, AUTHORED_ROOT, HELPER_PATH]
      = process.argv.slice(2);
    const AUTHORED_FILES = new Set();
    const RUNTIME_FILES = new Set([ENTRY_PATH, HELPER_PATH]);
    const NODE_BUILTINS = new Set(
      builtinModules.map(name => name.replace(/^node:/, ""))
    );
    const BUN_COMPATIBILITY_BUILTINS = new Set(["node-fetch", "ws"]);
    const RUNTIME_SPECIFIER = /^(?:@llm-space\\/runtime(?:\\/tools|\\/connections)?|typebox)$/;
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
          const extension = path.extname(args.path);
          const loader = extension === ".tsx"
            ? "tsx"
            : extension === ".ts" || extension === ".mts" || extension === ".cts"
              ? "ts"
              : extension === ".jsx" ? "jsx" : "js";
          return { contents: source, loader };
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
    helperPath
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
  helperPath: string
): string {
  const definitionPath = discovered.definition?.absolutePath;
  if (!definitionPath) { throw new Error("Agent definition is unavailable"); }
  const imports = [
    `import { createBundledAgentProject } from ${JSON.stringify(helperPath)};`,
    `import definition from ${JSON.stringify(definitionPath)};`,
    ...discovered.tools.map((source, index) =>
      `import tool${index} from ${JSON.stringify(source.absolutePath)};`),
    ...discovered.connections.map((source, index) =>
      `import connection${index} from ${JSON.stringify(source.absolutePath)};`)
  ];
  const tools = discovered.tools.map((source, index) => ({
    name: path.basename(source.absolutePath, path.extname(source.absolutePath)),
    sourcePath: source.logicalPath,
    definition: `tool${index}`
  }));
  const connections = discovered.connections.map((source, index) => ({
    name: path.basename(source.absolutePath, path.extname(source.absolutePath)),
    logicalPath: source.logicalPath,
    definition: `connection${index}`
  }));
  const skills = (project.resources.skills ?? []).map(skill => ({
    ...skill,
    filePath: path.posix.join("skills", skill.name, "SKILL.md")
  }));
  return `${imports.join("\n")}
const INPUT = {
  definition,
  instructions: ${JSON.stringify(project.instructions)},
  tools: [${tools.map(tool => `{ name: ${JSON.stringify(tool.name)}, sourcePath: ${JSON.stringify(tool.sourcePath)}, definition: ${tool.definition} }`).join(",")}],
  connections: [${connections.map(connection => `{ name: ${JSON.stringify(connection.name)}, logicalPath: ${JSON.stringify(connection.logicalPath)}, definition: ${connection.definition} }`).join(",")}],
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
