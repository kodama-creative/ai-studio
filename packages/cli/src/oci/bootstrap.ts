import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createStaticBearerAuthenticator,
  type ServerAuthenticator,
  startAgentServer,
  type StaticBearerPrincipal
} from "@llm-space/server";

import type { AgentProjectArtifact } from "@llm-space/runtime/server";

import {
  createOciEnvironmentManifest,
  type OciEnvironmentManifest
} from "./environment-manifest";

const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length > 0) {
    process.stderr.write("OCI Agent Server does not accept runtime arguments.\n");
    return 1;
  }
  try {
    const artifact = _artifact(await _jsonFile("artifact.json"));
    const manifest = _manifest(
      await _jsonFile("environment.json"),
      artifact
    );
    const host = _hostConfiguration();
    const authenticator = _serverAuthenticator();
    _validateAgentEnvironment(manifest);
    const bundleUrl = new URL("./agent.bundle.mjs", import.meta.url).href;
    const module = await import(bundleUrl) as {
      createAgentProject(artifact: AgentProjectArtifact): {
        artifact: AgentProjectArtifact;
        definition?: { environment?: unknown; model: { id: string; provider: string; }; };
      };
    };
    const project = module.createAgentProject(artifact);
    if (
      JSON.stringify(project.artifact) !== JSON.stringify(artifact)
      || _canonicalJson(project.definition?.environment ?? {})
      !== _canonicalJson(manifest.agent)
    ) {
      throw new Error("Agent bundle descriptor mismatch");
    }
    const server = await startAgentServer({
      artifactFingerprint: artifact.fingerprint,
      project: project as Parameters<typeof startAgentServer>[0]["project"],
      models: builtinModels(),
      authenticator,
      hostname: "0.0.0.0",
      port: 7331,
      repositoryRoot: "/var/lib/llm-space",
      localDev: false,
      allowedHosts: host.allowedHosts,
      allowedOrigins: host.allowedOrigins,
      trustedProxyCidrs: host.trustedProxyCidrs,
      maxActiveRuns: host.maxActiveRuns,
      continuationTtlSeconds: host.continuationTtlSeconds,
      shutdownTimeoutSeconds: host.shutdownTimeoutSeconds
    });
    process.stdout.write(`Agent Server listening on ${server.url}\n`);
    await _waitForStop(server.stop);
    return 0;
  } catch {
    process.stderr.write(
      "Unable to start OCI Agent Server; verify declared environment and mounted storage.\n"
    );
    return 1;
  }
}

async function _jsonFile(name: string): Promise<unknown> {
  return JSON.parse(await Bun.file(join(DIRECTORY, name)).text()) as unknown;
}

function _artifact(value: unknown): AgentProjectArtifact {
  const artifact = _record(value, "Agent artifact");
  if (
    !_exactKeys(artifact, ["fingerprint", "fingerprints", "schemaVersion"])
    || artifact.schemaVersion !== 1
    || !_isSha256(artifact.fingerprint)
  ) {
    throw new Error("Agent artifact descriptor is invalid");
  }
  const fingerprints = _record(
    artifact.fingerprints,
    "Agent artifact fingerprints"
  );
  const names = [
    "capabilities",
    "dependencies",
    "environmentRequirements",
    "runtime",
    "schemas",
    "sources"
  ] as const;
  if (!_exactKeys(fingerprints, names)) {
    throw new Error("Agent artifact fingerprints are invalid");
  }
  for (const name of names) {
    _validateFingerprintSection(fingerprints[name], name);
  }
  if (_fingerprint({ schemaVersion: 1, fingerprints }) !== artifact.fingerprint) {
    throw new Error("Agent artifact fingerprint mismatch");
  }
  const runtime = _record(fingerprints.runtime, "Runtime fingerprint section");
  const runtimeEntries = runtime.entries as ReadonlyArray<{ id: string; }>;
  if (!runtimeEntries.some(entry => entry.id === `bun-compiler@${Bun.version}`)) {
    throw new Error("Agent artifact was compiled with another Bun version");
  }
  return artifact as unknown as AgentProjectArtifact;
}

function _manifest(
  value: unknown,
  artifact: AgentProjectArtifact
): OciEnvironmentManifest {
  const manifest = _record(value, "OCI environment manifest");
  if (
    !_exactKeys(manifest, [
      "agent",
      "artifactFingerprint",
      "fixed",
      "host",
      "schemaVersion"
    ])
    || manifest.schemaVersion !== 1
    || manifest.artifactFingerprint !== artifact.fingerprint
  ) {
    throw new Error("OCI environment manifest is invalid");
  }
  const agent = _environmentRequirements(manifest.agent);
  const expected = createOciEnvironmentManifest(artifact.fingerprint, agent);
  if (
    _canonicalJson(manifest.fixed) !== _canonicalJson(expected.fixed)
    || _canonicalJson(manifest.host) !== _canonicalJson(expected.host)
  ) {
    throw new Error("OCI Host environment contract is invalid");
  }
  const artifactEntries = artifact.fingerprints.environmentRequirements.entries
    .filter(entry => entry.id.startsWith("agent-env:"));
  const manifestEntries = Object.entries(agent).map(([name, requirement]) => ({
    id: `agent-env:${name}`,
    fingerprint: _fingerprint(requirement)
  }));
  if (_canonicalJson(artifactEntries) !== _canonicalJson(manifestEntries)) {
    throw new Error("Agent environment requirements do not match the artifact");
  }
  return manifest as unknown as OciEnvironmentManifest;
}

function _environmentRequirements(value: unknown): OciEnvironmentManifest["agent"] {
  const requirements = _record(value, "Agent environment requirements");
  const output: Record<string, {
    description?: string;
    kind: "config" | "secret";
    required: boolean;
  }> = {};
  for (const name of Object.keys(requirements).sort(_compareCodePoint)) {
    const requirement = _record(
      requirements[name],
      `Agent environment requirement ${name}`
    );
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      || !_exactKeys(
        requirement,
        requirement.description === undefined
          ? ["kind", "required"]
          : ["description", "kind", "required"]
      )
      || (requirement.kind !== "config" && requirement.kind !== "secret")
      || typeof requirement.required !== "boolean"
      || (
        requirement.description !== undefined
        && (
          typeof requirement.description !== "string"
          || requirement.description.trim().length === 0
        )
      )
    ) {
      throw new Error(`Agent environment requirement is invalid: ${name}`);
    }
    output[name] = requirement as typeof output[string];
  }
  return output;
}

function _serverAuthenticator(): ServerAuthenticator {
  const value = process.env.LLM_SPACE_SERVER_AUTH_KEYS;
  delete process.env.LLM_SPACE_SERVER_AUTH_KEYS;
  if (!value) {
    throw new Error("LLM_SPACE_SERVER_AUTH_KEYS is required");
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("LLM_SPACE_SERVER_AUTH_KEYS must be a non-empty array");
  }
  return createStaticBearerAuthenticator(parsed as StaticBearerPrincipal[]);
}

function _validateAgentEnvironment(manifest: OciEnvironmentManifest): void {
  for (const [name, requirement] of Object.entries(manifest.agent)) {
    if (requirement.required && !process.env[name]) {
      throw new Error(`Required Agent environment is missing: ${name}`);
    }
  }
}

function _hostConfiguration() {
  return {
    allowedHosts: _stringArray("LLM_SPACE_SERVER_ALLOWED_HOSTS", true),
    allowedOrigins: _stringArray("LLM_SPACE_SERVER_CORS_ORIGINS", false),
    trustedProxyCidrs: _stringArray(
      "LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS",
      true
    ),
    maxActiveRuns: _integer("LLM_SPACE_SERVER_MAX_ACTIVE_RUNS", 4, 1, 64),
    continuationTtlSeconds: _integer(
      "LLM_SPACE_SERVER_CONTINUATION_TTL_SECONDS",
      86_400,
      60,
      2_592_000
    ),
    shutdownTimeoutSeconds: _integer(
      "LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS",
      8,
      1,
      300
    )
  };
}

function _stringArray(name: string, required: boolean): readonly string[] {
  const value = process.env[name];
  if (!value) {
    if (required) { throw new Error(`${name} is required`); }
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || (parsed.length === 0 && required)) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  const items: readonly unknown[] = parsed;
  const strings: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`${name} must be a JSON array of strings`);
    }
    strings.push(item);
  }
  return strings;
}

function _integer(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

async function _waitForStop(stopServer: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolveStop, rejectStop) => {
    const stop = () => { void stopAsync(); };
    const stopAsync = async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      try {
        await stopServer();
        resolveStop();
      } catch (error) {
        rejectStop(error instanceof Error ? error : new Error(String(error)));
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function _validateFingerprintSection(value: unknown, name: string): void {
  const section = _record(value, `${name} fingerprint section`);
  if (
    !_exactKeys(section, ["entries", "fingerprint"])
    || !_isSha256(section.fingerprint)
    || !Array.isArray(section.entries)
  ) {
    throw new Error(`Agent artifact ${name} fingerprint section is invalid`);
  }
  let previous = "";
  for (const value of section.entries) {
    const entry = _record(value, `${name} fingerprint entry`);
    if (
      !_exactKeys(entry, ["fingerprint", "id"])
      || typeof entry.id !== "string"
      || entry.id.length === 0
      || entry.id <= previous
      || !_isSha256(entry.fingerprint)
    ) {
      throw new Error(`Agent artifact ${name} fingerprint entry is invalid`);
    }
    previous = entry.id;
  }
  if (_fingerprint(section.entries) !== section.fingerprint) {
    throw new Error(`Agent artifact ${name} fingerprint mismatch`);
  }
}

function _record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function _exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  return _canonicalJson(Object.keys(value).sort(_compareCodePoint))
    === _canonicalJson([...keys].sort(_compareCodePoint));
}

function _isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function _fingerprint(value: unknown): string {
  return new Bun.CryptoHasher("sha256").update(_canonicalJson(value)).digest("hex");
}

function _canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("OCI fingerprint input must be finite JSON");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(_compareCodePoint)
      .map(key => `${JSON.stringify(key)}:${_canonicalJson(
        (value as Record<string, unknown>)[key]
      )}`)
      .join(",")}}`;
  }
  throw new TypeError("OCI fingerprint input must be JSON-compatible");
}

function _compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
