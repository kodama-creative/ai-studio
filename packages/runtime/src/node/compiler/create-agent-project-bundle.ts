import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
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

export interface AgentProjectBundle {
  readonly artifact: AgentProjectArtifact;
  readonly bundle: string;
  readonly environment: AgentEnvironmentRequirements;
}

export async function createAgentProjectBundle(
  agentRoot: string
): Promise<AgentProjectBundle> {
  const temporaryRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "llm-space-agent-bundle-"
  ));
  try {
    const compileRoot = join(temporaryRoot, "compile-source");
    const bundleRoot = join(temporaryRoot, "bundle-source");
    await cp(agentRoot, compileRoot, { recursive: true, errorOnExist: true });
    await cp(agentRoot, bundleRoot, { recursive: true, errorOnExist: true });
    const project = await loadAgentProject(compileRoot);
    assertValidAgentProject(project);
    const discovered = await discoverAgentProject(bundleRoot);
    if (!discovered.definition) {
      throw new Error("Agent project definition is unavailable");
    }
    const entryPath = join(temporaryRoot, "entry.mjs");
    await writeFile(entryPath, _entrySource(discovered, project), "utf8");
    const bundlePath = join(temporaryRoot, "agent.bundle.mjs");
    await _buildInFreshBunProcess(entryPath, bundlePath);
    const bundle = await readFile(bundlePath, "utf8");
    const verificationPath = join(temporaryRoot, "verify.mjs");
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

async function _buildInFreshBunProcess(
  entryPath: string,
  bundlePath: string
): Promise<void> {
  const scriptPath = `${bundlePath}.build.mjs`;
  await writeFile(scriptPath, `
    const [entryPath, bundlePath, resolveRoot] = process.argv.slice(2);
    const plugin = {
      name: "llm-space-deployment-dependencies",
      setup(build) {
        build.onResolve(
          { filter: /^(?:@llm-space\\/runtime(?:\\/tools|\\/connections)?|typebox)$/ },
          args => ({ path: Bun.resolveSync(args.path, resolveRoot) })
        );
      }
    };
    const result = await Bun.build({
      entrypoints: [entryPath],
      format: "esm",
      minify: {
        identifiers: false,
        syntax: true,
        whitespace: true
      },
      sourcemap: "none",
      target: "bun",
      write: false,
      plugins: [plugin]
    });
    if (!result.success || !result.outputs[0]) {
      throw new Error(result.logs.map(log => log.message).join("\\n") || "Unable to build Agent deployment bundle");
    }
    await Bun.write(bundlePath, result.outputs[0]);
  `, "utf8");
  const child = Bun.spawn([
    process.execPath,
    scriptPath,
    entryPath,
    bundlePath,
    import.meta.dir
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
  project: Awaited<ReturnType<typeof loadAgentProject>>
): string {
  const helperPath = fileURLToPath(
    new URL("./create-bundled-agent-project.ts", import.meta.url)
  );
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
const input = {
  definition,
  instructions: ${JSON.stringify(project.instructions)},
  tools: [${tools.map(tool => `{ name: ${JSON.stringify(tool.name)}, sourcePath: ${JSON.stringify(tool.sourcePath)}, definition: ${tool.definition} }`).join(",")}],
  connections: [${connections.map(connection => `{ name: ${JSON.stringify(connection.name)}, logicalPath: ${JSON.stringify(connection.logicalPath)}, definition: ${connection.definition} }`).join(",")}],
  skills: ${JSON.stringify(skills)}
};
const expectedArtifact = Object.freeze(${JSON.stringify(project.artifact)});
export const createAgentProject = artifact => {
  if (JSON.stringify(artifact) !== JSON.stringify(expectedArtifact)) {
    throw new Error("Bundled Agent artifact descriptor mismatch");
  }
  return createBundledAgentProject(input, artifact);
};
`;
}

function join(...parts: string[]): string {
  return path.join(...parts);
}
