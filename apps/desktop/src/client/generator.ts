import { GENERATOR_RPC } from "@/shared/generator-rpc";
import { createRpcClientProxy } from "@/shared/namespaced-rpc";
import type { RuntimeId } from "@/shared/runtime";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const generatorClient = createRpcClientProxy(
  GENERATOR_RPC,
  createElectrobunRpcClientTransport()
);

/**
 * Open the native folder picker for the project's parent directory. `path` is
 * `null` on cancel.
 */
export function pickGeneratorDirectory(): Promise<{ path: string | null }> {
  return generatorClient.pickDirectory().then((path) => ({ path }));
}

/**
 * Resolve `parentDir/projectName`, validate + create it, and authorize it
 * (bun-side) for the generator's writes + `uv` runs.
 */
export function prepareGeneratorDirectory(
  parentDir: string,
  projectName: string
): Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  return generatorClient.prepareDirectory(parentDir, projectName);
}

/** Whether `uv` is installed on the host, and its version when detectable. */
export function checkUv(): Promise<{ installed: boolean; version?: string }> {
  return generatorClient.checkUv();
}

/** Run `uv <args>` in an authorized project directory. */
export function runUv(
  rootDir: string,
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return generatorClient.runUv(rootDir, args, opts);
}

/** Write a text file under an authorized project directory. */
export async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  contents: string
): Promise<void> {
  await generatorClient.writeFile(rootDir, relativePath, contents);
}

/** Delete a file under an authorized project directory; no-op when missing. */
export async function removeProjectFile(
  rootDir: string,
  relativePath: string
): Promise<void> {
  await generatorClient.removeFile(rootDir, relativePath);
}

/** Open macOS Terminal in the generated project and run `make dev`. */
export function openGeneratorDevTerminal(rootDir: string): Promise<boolean> {
  return generatorClient.openDevTerminal(rootDir);
}

/** Resolve the model's real API key + named environment variable values. */
export function resolveGeneratorEnv(
  providerId: string,
  envNames: string[],
  profileId?: string,
  runtimeId?: RuntimeId
): Promise<{ modelApiKey: string; envValues: Record<string, string> }> {
  return generatorClient.resolveEnv(runtimeId, {
    providerId,
    profileId,
    envNames,
  });
}
