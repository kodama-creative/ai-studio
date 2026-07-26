import { rmSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME } from "./agent-bundle-compiler-support";

import type { AgentBundleCompilerSupport } from "./agent-bundle-compiler-support";

const COMPILER_SUPPORT_MODULES = new Map<
  string,
  Promise<AgentBundleCompilerSupportModule>
>();

export interface AgentBundleCompilerSupportModule {
  buildAgentProjectBundle(input: {
    authoredRoot: string;
    bundlePath: string;
    entryPath: string;
    instructionEntryPaths: readonly string[];
    toolEntryPaths: readonly string[];
  }): Promise<void>;
}

export async function loadAgentBundleCompilerSupport(
  support: AgentBundleCompilerSupport
): Promise<AgentBundleCompilerSupportModule> {
  const fingerprint = support.manifest.sha256;
  let modulePromise = COMPILER_SUPPORT_MODULES.get(fingerprint);
  if (!modulePromise) {
    modulePromise = _loadAgentBundleCompilerSupport(support).catch(error => {
      if (COMPILER_SUPPORT_MODULES.get(fingerprint) === modulePromise) {
        COMPILER_SUPPORT_MODULES.delete(fingerprint);
      }
      throw error;
    });
    COMPILER_SUPPORT_MODULES.set(fingerprint, modulePromise);
  }
  return modulePromise;
}

async function _loadAgentBundleCompilerSupport(
  support: AgentBundleCompilerSupport
): Promise<AgentBundleCompilerSupportModule> {
  const root = await mkdtemp(path.join(
    await realpath(tmpdir()),
    "llm-space-verified-compiler-support-"
  ));
  const supportPath = path.join(
    root,
    AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME
  );
  try {
    await writeFile(supportPath, support.bytes, {
      flag: "wx",
      mode: 0o600
    });
    const loaded = await import(
      `${pathToFileURL(supportPath).href}?sha256=${support.manifest.sha256}`
    );
    const compilerSupport = loaded as Partial<AgentBundleCompilerSupportModule>;
    if (typeof compilerSupport.buildAgentProjectBundle !== "function") {
      throw new Error("Agent bundle compiler support export is invalid");
    }
    process.once("exit", () => {
      rmSync(root, { recursive: true, force: true });
    });
    return compilerSupport as AgentBundleCompilerSupportModule;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
