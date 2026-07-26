import { builtinModules } from "node:module";
import path from "node:path";

import { transformDynamicToolSource } from "./transform-dynamic-tool-source";
import {
  assertInstructionSourceImports,
  assertNoNonLiteralRuntimeImports
} from "./validate-authored-source";

const BUN_COMPATIBILITY_BUILTINS = new Set(["node-fetch", "ws"]);
const NODE_BUILTINS = new Set(
  builtinModules.map(name => name.replace(/^node:/, ""))
);
const RUNTIME_SPECIFIER = /^(?:@llm-space\/runtime(?:\/tools|\/connections|\/state|\/instructions|\/outputs|\/sandbox)?|typebox)$/;

export interface AgentBundleBuildInput {
  readonly authoredRoot: string;
  readonly bundlePath: string;
  readonly entryPath: string;
  readonly helperPath: string;
  readonly instructionEntryPaths: readonly string[];
  readonly modulePaths?: Readonly<Record<string, string>>;
  readonly resolveRoot?: string;
  readonly toolEntryPaths: readonly string[];
}

export async function runAgentBundleBuild(
  input: AgentBundleBuildInput
): Promise<void> {
  const authoredFiles = new Set<string>();
  const instructionEntryFiles = new Set(input.instructionEntryPaths);
  const instructionFiles = new Set(instructionEntryFiles);
  const toolEntryFiles = new Set(input.toolEntryPaths);
  const runtimeFiles = new Set([input.entryPath, input.helperPath]);
  const stateRoot = path.join(input.authoredRoot, "state");
  const modulePaths = input.modulePaths ?? {};
  const resolveRoot = input.resolveRoot;
  const plugin: Bun.BunPlugin = {
    name: "llm-space-deployment-dependencies",
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (_isBuiltin(args.path)) { return; }
        if (args.path === input.entryPath) {
          return { path: input.entryPath };
        }
        const supportModulePath = modulePaths[args.path];
        if (supportModulePath) { return { path: supportModulePath }; }
        const runtimeSpecifier = RUNTIME_SPECIFIER.test(args.path);
        if (runtimeSpecifier && !resolveRoot) {
          throw new Error(
            `Agent compiler support does not provide module: ${args.path}`
          );
        }
        const resolveFrom = runtimeSpecifier
          ? resolveRoot
          : args.importer ? path.dirname(args.importer) : resolveRoot;
        if (!resolveFrom) {
          throw new Error(`Unable to resolve Agent bundle import: ${args.path}`);
        }
        const resolved = Bun.resolveSync(args.path, resolveFrom);
        if (
          instructionFiles.has(args.importer)
          && args.path.startsWith(".")
          && !resolved.startsWith(`${stateRoot}${path.sep}`)
        ) {
          throw new Error("Instruction dependency escapes agent/state");
        }
        if (
          instructionFiles.has(args.importer)
          && resolved.startsWith(`${stateRoot}${path.sep}`)
        ) {
          instructionFiles.add(resolved);
        }
        if (args.importer === input.entryPath) {
          if (resolved.startsWith(`${input.authoredRoot}${path.sep}`)) {
            authoredFiles.add(resolved);
          } else {
            runtimeFiles.add(resolved);
          }
        } else if (runtimeSpecifier || runtimeFiles.has(args.importer)) {
          runtimeFiles.add(resolved);
        } else if (
          authoredFiles.has(args.importer)
          || args.importer.startsWith(`${input.authoredRoot}${path.sep}`)
        ) {
          authoredFiles.add(resolved);
        }
        return { path: resolved };
      });
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        if (!authoredFiles.has(args.path)) { return; }
        const source = await Bun.file(args.path).text();
        assertNoNonLiteralRuntimeImports(source, args.path);
        if (instructionFiles.has(args.path)) {
          assertInstructionSourceImports(source, args.path, {
            entryPaths: [...instructionEntryFiles],
            stateRoot
          });
        }
        return {
          contents: toolEntryFiles.has(args.path)
            ? transformDynamicToolSource(
              source,
              path.relative(input.authoredRoot, args.path)
                .split(path.sep)
                .join(path.posix.sep)
            )
            : source,
          loader: _loader(args.path)
        };
      });
    }
  };
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [input.entryPath],
      format: "esm",
      minify: {
        identifiers: false,
        syntax: true,
        whitespace: true
      },
      sourcemap: "none",
      target: "bun",
      plugins: [plugin]
    });
  } catch (error) {
    throw new Error(_buildFailureMessage(error), { cause: error });
  }
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      result.logs.map(log => log.message).join("\n")
      || "Unable to build Agent deployment bundle"
    );
  }
  await Bun.write(input.bundlePath, result.outputs[0]);
}

function _buildFailureMessage(error: unknown): string {
  const messages: string[] = [];
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") {
      if (typeof candidate === "string") { messages.push(candidate); }
      return;
    }
    if (candidate instanceof Error && candidate.message !== "Bundle failed") {
      messages.push(candidate.message);
    }
    const details = candidate as {
      cause?: unknown;
      errors?: readonly unknown[];
      logs?: readonly unknown[];
      message?: unknown;
    };
    if (
      !(candidate instanceof Error)
      && typeof details.message === "string"
    ) {
      messages.push(details.message);
    }
    details.errors?.forEach(visit);
    details.logs?.forEach(visit);
    if (details.cause && details.cause !== candidate) { visit(details.cause); }
  };
  visit(error);
  return [...new Set(messages)].join("\n")
    || "Unable to build Agent deployment bundle";
}

function _isBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:")
    || specifier.startsWith("bun:")
    || NODE_BUILTINS.has(specifier)
    || BUN_COMPATIBILITY_BUILTINS.has(specifier);
}

function _loader(filePath: string): "js" | "jsx" | "ts" | "tsx" {
  const extension = path.extname(filePath);
  if (extension === ".tsx") { return "tsx"; }
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") {
    return "ts";
  }
  if (extension === ".jsx") { return "jsx"; }
  return "js";
}
