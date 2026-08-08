import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

import { discoverExtensionSource } from "./discovery";
import type {
  AgentDiagnostic,
  AgentExtensionSourceRef,
  AgentSourceManifest,
} from "./types";

export interface ResolvedSourceExtension {
  readonly manifest: AgentSourceManifest;
  readonly mount: AgentExtensionSourceRef;
  readonly namespace: string;
  readonly nodeId: string;
  readonly packageName: string;
  readonly packageRoot: string;
  readonly sourceRoot: string;
}

function _diagnostic(
  code: string,
  message: string,
  sourcePath: string
): AgentDiagnostic {
  return { code, message, severity: "error", sourcePath };
}

function _mountSpecifier(source: string): string | undefined {
  const reexport =
    /export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*["']([^"']+)["']/.exec(source);
  if (reexport?.[1] !== undefined) return reexport[1];
  return /import\s+[A-Za-z_$][\w$]*\s+from\s+["']([^"']+)["']/.exec(
    source
  )?.[1];
}

async function _isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function _packageRoot(entryPath: string): Promise<string | undefined> {
  let current = (await _isFile(entryPath)) ? dirname(entryPath) : entryPath;
  const root = parse(current).root;
  while (true) {
    if (await _isFile(join(current, "package.json"))) return current;
    if (current === root) return undefined;
    current = dirname(current);
  }
}

function _extensionSource(
  pkg: Readonly<Record<string, unknown>>
): string | undefined {
  for (const key of ["llmSpace", "eve"] as const) {
    const owner = pkg[key];
    if (typeof owner !== "object" || owner === null || Array.isArray(owner))
      continue;
    const extension = (owner as Readonly<Record<string, unknown>>).extension;
    if (
      typeof extension !== "object" ||
      extension === null ||
      Array.isArray(extension)
    )
      continue;
    const source = (extension as Readonly<Record<string, unknown>>).source;
    if (typeof source === "string" && source.length > 0) return source;
  }
  return undefined;
}

function _resolveEntry(specifier: string, mountPath: string): string {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return resolve(dirname(mountPath), specifier);
  }
  return Bun.resolveSync(specifier, dirname(mountPath));
}

export async function resolveSourceExtensions(input: {
  readonly appRoot: string;
  readonly agentRoot: string;
  readonly mounts: readonly AgentExtensionSourceRef[];
}): Promise<{
  readonly diagnostics: readonly AgentDiagnostic[];
  readonly extensions: readonly ResolvedSourceExtension[];
}> {
  const diagnostics: AgentDiagnostic[] = [];
  const extensions: ResolvedSourceExtension[] = [];
  const packageNames = new Set<string>();

  for (const mount of input.mounts) {
    const mountPath = join(input.agentRoot, mount.logicalPath);
    let specifier: string | undefined;
    try {
      specifier = _mountSpecifier(await readFile(mountPath, "utf8"));
    } catch {
      // The diagnostic below describes both unreadable and malformed mounts.
    }
    if (specifier === undefined) {
      diagnostics.push(
        _diagnostic(
          "load/extension-mount-invalid",
          `Extension mount "${mount.logicalPath}" must default-export a mounted extension imported from a package.`,
          mountPath
        )
      );
      continue;
    }

    let packageRoot: string | undefined;
    try {
      packageRoot = await _packageRoot(_resolveEntry(specifier, mountPath));
    } catch {
      // Report a stable resolution diagnostic below.
    }
    if (packageRoot === undefined) {
      diagnostics.push(
        _diagnostic(
          "load/extension-package-unresolved",
          `Could not resolve extension package "${specifier}" from "${mount.logicalPath}".`,
          mountPath
        )
      );
      continue;
    }

    let pkg: Readonly<Record<string, unknown>>;
    try {
      pkg = JSON.parse(
        await readFile(join(packageRoot, "package.json"), "utf8")
      ) as Readonly<Record<string, unknown>>;
    } catch {
      diagnostics.push(
        _diagnostic(
          "load/extension-package-invalid",
          `Extension package at "${packageRoot}" has no readable package.json.`,
          join(packageRoot, "package.json")
        )
      );
      continue;
    }
    const packageName = typeof pkg.name === "string" ? pkg.name : specifier;
    const source = _extensionSource(pkg);
    if (source === undefined) {
      diagnostics.push(
        _diagnostic(
          "load/extension-source-missing",
          `Extension package "${packageName}" must declare llmSpace.extension.source or eve.extension.source.`,
          join(packageRoot, "package.json")
        )
      );
      continue;
    }
    if (packageNames.has(packageName)) {
      diagnostics.push(
        _diagnostic(
          "load/extension-package-duplicate",
          `Extension package "${packageName}" cannot be mounted more than once in one agent.`,
          mountPath
        )
      );
      continue;
    }
    packageNames.add(packageName);

    const namespace = mount.name ?? mount.moduleId;
    const sourceRoot = resolve(packageRoot, source);
    const discovered = await discoverExtensionSource({
      appRoot: input.appRoot,
      packageName,
      sourceRoot,
    });
    diagnostics.push(...discovered.diagnostics);
    extensions.push({
      manifest: discovered.manifest,
      mount,
      namespace,
      nodeId: `extension:${namespace}`,
      packageName,
      packageRoot,
      sourceRoot,
    });
  }

  return { diagnostics, extensions };
}
