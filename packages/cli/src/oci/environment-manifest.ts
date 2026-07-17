import type {
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements
} from "@llm-space/runtime";

export const OCI_ENVIRONMENT_MANIFEST_SCHEMA_VERSION = 1;

const HOST_ENVIRONMENT = Object.freeze({
  LLM_SPACE_SERVER_ALLOWED_HOSTS: _requirement(
    "config",
    true,
    "JSON array of accepted public Host values"
  ),
  LLM_SPACE_SERVER_AUTH_KEYS: _requirement(
    "secret",
    true,
    "Static Bearer principal keyring JSON"
  ),
  LLM_SPACE_SERVER_CONTINUATION_TTL_SECONDS: _requirement(
    "config",
    false,
    "Continuation lifetime from 60 through 2592000 seconds"
  ),
  LLM_SPACE_SERVER_CORS_ORIGINS: _requirement(
    "config",
    false,
    "JSON array of exact HTTPS browser origins"
  ),
  LLM_SPACE_SERVER_MAX_ACTIVE_RUNS: _requirement(
    "config",
    false,
    "Global active Run limit from 1 through 64"
  ),
  LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS: _requirement(
    "config",
    false,
    "Server drain timeout from 1 through 300 seconds; defaults to 8"
  ),
  LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS: _requirement(
    "config",
    true,
    "JSON array of exact trusted TLS terminator IP/CIDR values"
  )
});

export interface OciEnvironmentManifest {
  readonly agent: AgentEnvironmentRequirements;
  readonly artifactFingerprint: string;
  readonly fixed: {
    readonly host: "0.0.0.0";
    readonly localDev: false;
    readonly port: 7331;
    readonly repositoryRoot: "/var/lib/llm-space";
    readonly runtimeUser: "1000:1000";
    readonly shutdownTimeoutSeconds: 8;
  };
  readonly host: AgentEnvironmentRequirements;
  readonly schemaVersion: typeof OCI_ENVIRONMENT_MANIFEST_SCHEMA_VERSION;
}

export function createOciEnvironmentManifest(
  artifactFingerprint: string,
  agent: AgentEnvironmentRequirements
): OciEnvironmentManifest {
  for (const name of Object.keys(agent)) {
    if (Object.hasOwn(HOST_ENVIRONMENT, name)) {
      throw new TypeError(
        `Agent environment requirement cannot redefine Server Host input: ${name}`
      );
    }
  }
  return Object.freeze({
    schemaVersion: OCI_ENVIRONMENT_MANIFEST_SCHEMA_VERSION,
    artifactFingerprint,
    fixed: Object.freeze({
      host: "0.0.0.0" as const,
      port: 7331 as const,
      localDev: false as const,
      repositoryRoot: "/var/lib/llm-space" as const,
      runtimeUser: "1000:1000" as const,
      shutdownTimeoutSeconds: 8 as const
    }),
    host: HOST_ENVIRONMENT,
    agent
  });
}

function _requirement(
  kind: AgentEnvironmentRequirement["kind"],
  required: boolean,
  description: string
): AgentEnvironmentRequirement {
  return Object.freeze({ kind, required, description });
}
