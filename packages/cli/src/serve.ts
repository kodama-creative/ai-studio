import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { loadAgentProject } from "@llm-space/runtime/node";
import {
  createStaticBearerAuthenticator,
  startAgentServer,
  type StaticBearerPrincipal
} from "@llm-space/server";

export interface ServeAgentProjectOptions {
  readonly agentRoot: string;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly continuationTtlSeconds: number;
  readonly hostname: string;
  readonly localDev: boolean;
  readonly maxActiveRuns: number;
  readonly port: number;
  readonly repositoryRoot?: string;
  readonly shutdownTimeoutSeconds: number;
  readonly tlsCertificatePath?: string;
  readonly tlsKeyPath?: string;
  readonly trustedProxyCidrs: readonly string[];
}

export async function serveAgentProject(
  options: ServeAgentProjectOptions
): Promise<void> {
  const principals = _serverPrincipals(options.localDev);
  const authenticator = createStaticBearerAuthenticator(principals);
  const tls = await _tlsOptions(options);
  const project = await loadAgentProject(resolve(options.agentRoot));
  const repositoryRoot = options.repositoryRoot
    ? resolve(options.repositoryRoot)
    : join(
      homedir(),
      ".llm-space",
      "servers",
      project.artifact.fingerprint
    );
  const server = await startAgentServer({
    artifactFingerprint: project.artifact.fingerprint,
    project,
    models: builtinModels(),
    authenticator,
    hostname: options.hostname,
    port: options.port,
    repositoryRoot,
    localDev: options.localDev,
    maxActiveRuns: options.maxActiveRuns,
    continuationTtlSeconds: options.continuationTtlSeconds,
    shutdownTimeoutSeconds: options.shutdownTimeoutSeconds,
    allowedOrigins: options.allowedOrigins,
    allowedHosts: options.allowedHosts,
    trustedProxyCidrs: options.trustedProxyCidrs,
    ...(tls ? { tls } : {})
  });
  process.stdout.write(`Agent Server listening on ${server.url}\n`);
  await new Promise<void>((resolveStop, rejectStop) => {
    const stop = () => { void stopAsync(); };
    const stopAsync = async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      try {
        await server.stop();
        resolveStop();
      } catch (error) {
        rejectStop(error instanceof Error ? error : new Error(String(error)));
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function _serverPrincipals(localDev: boolean): readonly StaticBearerPrincipal[] {
  const localDevKey = process.env.LLM_SPACE_SERVER_LOCAL_DEV_KEY;
  const keyringValue = process.env.LLM_SPACE_SERVER_AUTH_KEYS;
  delete process.env.LLM_SPACE_SERVER_LOCAL_DEV_KEY;
  delete process.env.LLM_SPACE_SERVER_AUTH_KEYS;
  if (localDev) {
    if (!localDevKey) {
      throw new Error("LLM_SPACE_SERVER_LOCAL_DEV_KEY is required for --local-dev");
    }
    return [{
      issuer: "llm-space-local-dev",
      principalId: `local-${typeof process.getuid === "function" ? process.getuid() : "user"}`,
      principalType: "user",
      token: localDevKey
    }];
  }
  if (!keyringValue) {
    throw new Error("LLM_SPACE_SERVER_AUTH_KEYS is required outside local-dev");
  }
  let value: unknown;
  try {
    value = JSON.parse(keyringValue);
  } catch {
    throw new Error("LLM_SPACE_SERVER_AUTH_KEYS must be valid JSON");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("LLM_SPACE_SERVER_AUTH_KEYS must be a non-empty array");
  }
  return value as StaticBearerPrincipal[];
}

async function _tlsOptions(
  options: ServeAgentProjectOptions
): Promise<Bun.TLSOptions | undefined> {
  if (!options.tlsCertificatePath && !options.tlsKeyPath) {
    return undefined;
  }
  if (!options.tlsCertificatePath || !options.tlsKeyPath) {
    throw new Error("Both --tls-cert and --tls-key are required for direct TLS");
  }
  return {
    cert: await Bun.file(resolve(options.tlsCertificatePath)).text(),
    key: await Bun.file(resolve(options.tlsKeyPath)).text()
  };
}
