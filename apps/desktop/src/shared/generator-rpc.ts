import { defineRpcNamespace } from "./namespaced-rpc";
import type { RuntimeId } from "./runtime";

export interface GeneratorRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface GeneratorRequests {
  pickDirectory(): Promise<string | null>;
  prepareDirectory(
    parentDir: string,
    projectName: string
  ): Promise<{ ok: true; dir: string } | { ok: false; error: string }>;
  checkUv(): Promise<{ installed: boolean; version?: string }>;
  runUv(
    rootDir: string,
    args: string[],
    options?: { timeoutMs?: number }
  ): Promise<GeneratorRunResult>;
  writeFile(
    rootDir: string,
    relativePath: string,
    contents: string
  ): Promise<void>;
  removeFile(rootDir: string, relativePath: string): Promise<void>;
  openDevTerminal(rootDir: string): Promise<boolean>;
  resolveEnv(
    runtimeId: RuntimeId | undefined,
    input: { providerId: string; profileId?: string; envNames: string[] }
  ): Promise<{ modelApiKey: string; envValues: Record<string, string> }>;
}

export interface GeneratorRpc {
  readonly requests: GeneratorRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export const GENERATOR_RPC = defineRpcNamespace<GeneratorRpc>("generator", {
  streams: [],
  events: [],
});
