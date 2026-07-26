import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_BUNDLE_COMPILER_SUPPORT_HELPER_SPECIFIER } from "./agent-bundle-compiler-support";

const RUNTIME_MODULE_ENTRYPOINTS = Object.freeze({
  "@llm-space/runtime": "../../index.ts",
  "@llm-space/runtime/connections": "../../public/connections/index.ts",
  "@llm-space/runtime/instructions": "../../public/instructions/index.ts",
  "@llm-space/runtime/outputs": "../../public/outputs/index.ts",
  "@llm-space/runtime/sandbox": "../../public/sandbox/index.ts",
  "@llm-space/runtime/state": "../../public/state/index.ts",
  "@llm-space/runtime/tools": "../../public/tools/index.ts"
});
const RUNNER_SUPPORT_SPECIFIER = "llm-space:compiler/run-agent-bundle-build";
const TYPESCRIPT_SUPPORT_SPECIFIER = "llm-space:compiler/typescript";
const TYPESCRIPT_ENTRY_PATH = Bun.resolveSync("typescript", import.meta.dir);
const TYPESCRIPT_LIB_PATH = path.dirname(TYPESCRIPT_ENTRY_PATH);
const VIRTUAL_TYPESCRIPT_ENTRY_PATH =
  "/llm-space/compiler-support/typescript/lib/typescript.js";
const VIRTUAL_TYPESCRIPT_LIB_PATH =
  "/llm-space/compiler-support/typescript/lib";

export async function buildAgentBundleCompilerSupport(): Promise<Uint8Array> {
  const temporaryRoot = await mkdtemp(path.join(
    tmpdir(),
    "llm-space-support-build-"
  ));
  try {
    const moduleSources: Record<string, string> = {};
    for (const [specifier, relativePath] of Object.entries(
      RUNTIME_MODULE_ENTRYPOINTS
    )) {
      moduleSources[specifier] = await _bundleModule(
        fileURLToPath(new URL(relativePath, import.meta.url))
      );
    }
    moduleSources.typebox = await _bundleModule(
      Bun.resolveSync("typebox", import.meta.dir)
    );
    moduleSources[AGENT_BUNDLE_COMPILER_SUPPORT_HELPER_SPECIFIER] =
      await _bundleModule(
        fileURLToPath(
          new URL("./create-bundled-agent-project.ts", import.meta.url)
        )
      );
    moduleSources[TYPESCRIPT_SUPPORT_SPECIFIER] =
      _normalizeBundledCompilerPaths(await _bundleModule(
        TYPESCRIPT_ENTRY_PATH,
        {
          minifyIdentifiers: true,
          plugins: [_stableTypeScriptOptionalDependenciesPlugin()]
        }
      ));
    moduleSources[RUNNER_SUPPORT_SPECIFIER] = await _bundleModule(
      fileURLToPath(
        new URL("./run-agent-bundle-build.ts", import.meta.url)
      ),
      { plugins: [_externalTypeScriptPlugin()] }
    );
    const entryPath = path.join(temporaryRoot, "support-entry.ts");
    await writeFile(entryPath, _supportEntrySource(moduleSources), "utf8");
    const result = await Bun.build({
      entrypoints: [entryPath],
      format: "esm",
      minify: true,
      sourcemap: "none",
      target: "bun"
    });
    if (!result.success || !result.outputs[0]) {
      throw new Error(
        result.logs.map(log => log.message).join("\n")
        || "Unable to generate Agent bundle compiler support"
      );
    }
    return new Uint8Array(await result.outputs[0].arrayBuffer());
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function _normalizeBundledCompilerPaths(source: string): string {
  const normalized = source
    .replaceAll(
      JSON.stringify(TYPESCRIPT_ENTRY_PATH),
      JSON.stringify(VIRTUAL_TYPESCRIPT_ENTRY_PATH)
    )
    .replaceAll(
      JSON.stringify(TYPESCRIPT_LIB_PATH),
      JSON.stringify(VIRTUAL_TYPESCRIPT_LIB_PATH)
    );
  if (
    normalized.includes(TYPESCRIPT_ENTRY_PATH)
    || normalized.includes(TYPESCRIPT_LIB_PATH)
  ) {
    throw new Error("Unable to normalize bundled TypeScript paths");
  }
  return normalized;
}

async function _bundleModule(
  entryPath: string,
  options: {
    readonly minifyIdentifiers?: boolean;
    readonly plugins?: readonly Bun.BunPlugin[];
  } = {}
): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entryPath],
    format: "esm",
    minify: options.minifyIdentifiers
      ? true
      : {
        identifiers: false,
        syntax: true,
        whitespace: true
      },
    plugins: options.plugins ? [...options.plugins] : [],
    sourcemap: "none",
    target: "bun"
  });
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      result.logs.map(log => log.message).join("\n")
      || `Unable to bundle Agent compiler module: ${entryPath}`
    );
  }
  return result.outputs[0].text();
}

function _externalTypeScriptPlugin(): Bun.BunPlugin {
  return {
    name: "llm-space-external-typescript",
    setup(build) {
      build.onResolve({ filter: /^typescript$/ }, () => ({
        namespace: "llm-space-typescript-redirect",
        path: "typescript"
      }));
      build.onLoad(
        { filter: /.*/, namespace: "llm-space-typescript-redirect" },
        () => ({
          contents: `export { default } from ${JSON.stringify(TYPESCRIPT_SUPPORT_SPECIFIER)};`,
          loader: "js"
        })
      );
      build.onResolve(
        { filter: /^llm-space:compiler\/typescript$/ },
        args => ({ external: true, path: args.path })
      );
    }
  };
}

function _stableTypeScriptOptionalDependenciesPlugin(): Bun.BunPlugin {
  return {
    name: "llm-space-stable-typescript-optional-dependencies",
    setup(build) {
      build.onResolve({ filter: /^source-map-support$/ }, () => ({
        namespace: "llm-space-source-map-support-stub",
        path: "source-map-support"
      }));
      build.onLoad(
        { filter: /.*/, namespace: "llm-space-source-map-support-stub" },
        () => ({
          contents: "export function install() {}",
          loader: "js"
        })
      );
    }
  };
}

function _supportEntrySource(
  moduleSources: Readonly<Record<string, string>>
): string {
  return `import { rmSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
let SOURCE_ENTRIES = Object.entries(${JSON.stringify(moduleSources)});
let modulePathsPromise = null;
async function materializeModulePaths() {
  const root = await mkdtemp(path.join(
    await realpath(tmpdir()),
    "llm-space-compiler-modules-"
  ));
  try {
    const modulePaths = {};
    for (let index = 0; index < SOURCE_ENTRIES.length; index += 1) {
      const [specifier] = SOURCE_ENTRIES[index];
      const modulePath = path.join(root, "module-" + index + ".mjs");
      modulePaths[specifier] = modulePath;
    }
    for (let index = 0; index < SOURCE_ENTRIES.length; index += 1) {
      const [specifier, source] = SOURCE_ENTRIES[index];
      const modulePath = modulePaths[specifier];
      const materializedSource = specifier === ${JSON.stringify(RUNNER_SUPPORT_SPECIFIER)}
        ? source.replaceAll(
          ${JSON.stringify(JSON.stringify(TYPESCRIPT_SUPPORT_SPECIFIER))},
          JSON.stringify(modulePaths[${JSON.stringify(TYPESCRIPT_SUPPORT_SPECIFIER)}])
        )
        : source;
      await writeFile(modulePath, materializedSource, "utf8");
    }
    SOURCE_ENTRIES = [];
    process.once("exit", () => {
      rmSync(root, { recursive: true, force: true });
    });
    return Object.freeze(modulePaths);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
async function getModulePaths() {
  modulePathsPromise = modulePathsPromise
    ?? materializeModulePaths().catch(error => {
      modulePathsPromise = null;
      throw error;
    });
  return modulePathsPromise;
}
export async function buildAgentProjectBundle(input) {
  const modulePaths = await getModulePaths();
  const { runAgentBundleBuild } = await import(
    modulePaths[${JSON.stringify(RUNNER_SUPPORT_SPECIFIER)}]
  );
  await runAgentBundleBuild({
  ...input,
  helperPath: modulePaths[${JSON.stringify(AGENT_BUNDLE_COMPILER_SUPPORT_HELPER_SPECIFIER)}],
  modulePaths
  });
}
`;
}
