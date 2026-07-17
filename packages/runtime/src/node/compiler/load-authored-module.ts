import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as TypeBox from "typebox";

import {
  createAuthoredDefinitionVirtualModule,
  defineMcpClientConnectionRuntime,
  defineToolRuntime
} from "../../internal/authored-action-definitions";

const TYPEBOX_RUNTIME_KEY = Symbol.for("llm-space.typebox-runtime");

Object.defineProperty(globalThis, TYPEBOX_RUNTIME_KEY, {
  value: TypeBox,
  configurable: false,
  enumerable: false,
  writable: false
});

export async function loadAuthoredModule({
  projectRoot,
  sourcePath,
  authoredSdk = false,
  validateEntrySource
}: {
  authoredSdk?: boolean;
  projectRoot: string;
  sourcePath: string;
  validateEntrySource?: (source: string, filePath: string) => void;
}): Promise<{
  default?: unknown;
  dependencies: readonly AuthoredModuleDependencyFingerprint[];
  fingerprint: string;
  source: string;
}> {
  const canonicalRoot = await realpath(projectRoot);
  const canonicalSource = await realpath(sourcePath);
  const entrySource = await readFile(canonicalSource);
  validateEntrySource?.(entrySource.toString("utf8"), canonicalSource);
  const capturedInputs = new Map<string, Buffer>([
    [canonicalSource, entrySource]
  ]);
  const plugins = [_sourceSnapshotPlugin(capturedInputs)];
  if (authoredSdk) { plugins.push(_authoredSdkPlugin()); }
  const result = await Bun.build({
    entrypoints: [sourcePath],
    bundle: true,
    format: "esm",
    target: "bun",
    write: false,
    sourcemap: "inline",
    plugins
  } as Parameters<typeof Bun.build>[0]);
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      result.logs.map(log => log.message).join("\n")
      || `Unable to compile ${sourcePath}`
    );
  }
  const source = await result.outputs[0].text();
  const sourceInput = capturedInputs.get(canonicalSource);
  if (!sourceInput) {
    throw new Error(`Bundler did not load Agent source: ${sourcePath}`);
  }
  const dependencies = _dependencyFingerprints({
    capturedInputs,
    canonicalRoot,
    canonicalSource
  });
  const fingerprint = createHash("sha256")
    .update(sourcePath)
    .update(source)
    .digest("hex");
  const cacheRoot = path.join(
    await realpath(tmpdir()),
    "llm-space-runtime-modules"
  );
  const cachePath = path.join(
    cacheRoot,
    `${authoredSdk ? "definition" : "source"}-${fingerprint}.mjs`
  );
  await mkdir(cacheRoot, { recursive: true });
  try {
    await writeFile(cachePath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!_hasCode(error, "EEXIST")) {
      throw error;
    }
  }
  const module: unknown = await import(
    `${pathToFileURL(cachePath).href}?v=${fingerprint}`
  );
  return module && typeof module === "object" && "default" in module
    ? {
      default: module.default,
      dependencies,
      fingerprint,
      source: sourceInput.toString("utf8")
    }
    : { dependencies, fingerprint, source: sourceInput.toString("utf8") };
}

function _sourceSnapshotPlugin(
  capturedInputs: Map<string, Buffer>
): Bun.BunPlugin {
  return {
    name: "llm-space-source-snapshot",
    setup(build) {
      build.onLoad(
        { filter: /.*/, namespace: "file" },
        async args => {
          const absolutePath = await realpath(args.path);
          let contents = capturedInputs.get(absolutePath);
          if (!contents) {
            contents = await readFile(absolutePath);
            capturedInputs.set(absolutePath, contents);
          }
          return { contents, loader: args.loader };
        }
      );
    }
  };
}

function _authoredSdkPlugin(): Bun.BunPlugin {
  return {
    name: "llm-space-agent-definition",
    setup(build) {
      build.onResolve({ filter: /^@llm-space\/runtime$/ }, () => ({
        path: "agent-definition",
        namespace: "llm-space-runtime"
      }));
      build.onLoad(
        {
          filter: /^agent-definition$/,
          namespace: "llm-space-runtime"
        },
        () => ({
          contents: "export const defineAgent = (definition) => definition;",
          loader: "js"
        })
      );
      build.onResolve(
        { filter: /^@llm-space\/runtime\/tools$/ },
        () => ({
          path: "tool-definition",
          namespace: "llm-space-runtime"
        })
      );
      build.onLoad(
        {
          filter: /^tool-definition$/,
          namespace: "llm-space-runtime"
        },
        () => ({
          contents: createAuthoredDefinitionVirtualModule(
            "defineTool",
            defineToolRuntime
          ),
          loader: "js"
        })
      );
      build.onResolve(
        { filter: /^@llm-space\/runtime\/connections$/ },
        () => ({
          path: "connection-definition",
          namespace: "llm-space-runtime"
        })
      );
      build.onLoad(
        {
          filter: /^connection-definition$/,
          namespace: "llm-space-runtime"
        },
        () => ({
          contents: createAuthoredDefinitionVirtualModule(
            "defineMcpClientConnection",
            defineMcpClientConnectionRuntime
          ),
          loader: "js"
        })
      );
      build.onResolve({ filter: /^typebox$/ }, () => ({
        path: "typebox-runtime",
        namespace: "llm-space-runtime"
      }));
      build.onLoad(
        {
          filter: /^typebox-runtime$/,
          namespace: "llm-space-runtime"
        },
        () => ({
          contents: `
              const runtime = globalThis[Symbol.for("llm-space.typebox-runtime")];
              if (!runtime) throw new Error("TypeBox authored runtime is unavailable");
              export const Type = runtime.Type;
              export const Format = runtime.Format;
              export const Schema = runtime.Schema;
            `,
          loader: "js"
        })
      );
    }
  };
}

interface AuthoredModuleDependencyFingerprint {
  readonly fingerprint: string;
  readonly id: string;
}

function _dependencyFingerprints({
  capturedInputs,
  canonicalRoot,
  canonicalSource
}: {
  canonicalRoot: string;
  canonicalSource: string;
  capturedInputs: ReadonlyMap<string, Buffer>;
}): AuthoredModuleDependencyFingerprint[] {
  const dependencies: AuthoredModuleDependencyFingerprint[] = [];
  for (const [absolutePath, content] of capturedInputs) {
    if (absolutePath === canonicalSource) { continue; }
    const fingerprint = createHash("sha256").update(content).digest("hex");
    dependencies.push({
      id: _dependencyId(canonicalRoot, absolutePath, fingerprint),
      fingerprint
    });
  }
  return dependencies.sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
}

function _dependencyId(
  projectRoot: string,
  absolutePath: string,
  fingerprint: string
): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (relative && !relative.startsWith(`..${path.sep}`)) {
    return `project:${relative.split(path.sep).join(path.posix.sep)}`;
  }
  const normalized = absolutePath.split(path.sep).join(path.posix.sep);
  const bunPackageMarker = "/node_modules/.bun/";
  const bunPackageIndex = normalized.lastIndexOf(bunPackageMarker);
  if (bunPackageIndex >= 0) {
    return `package:${normalized.slice(bunPackageIndex + bunPackageMarker.length)}`;
  }
  const packageMarker = "/node_modules/";
  const packageIndex = normalized.lastIndexOf(packageMarker);
  if (packageIndex >= 0) {
    return `package:${normalized.slice(packageIndex + packageMarker.length)}`;
  }
  return `content:${path.basename(absolutePath)}:${fingerprint}`;
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
