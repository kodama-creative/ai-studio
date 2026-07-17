#!/usr/bin/env bun

import { loadAgentProjectManifest } from "@llm-space/runtime/node";

import { createOciBuildContext } from "./oci-build-context";
import { scaffoldAgentProject } from "./scaffold";
import { serveAgentProject } from "./serve";

const HELP = `LLM Space Agent Project CLI

Usage:
  llm-space init [directory] [--blank]
  llm-space build [directory] --target oci --output <directory>
  llm-space serve [directory] [options]

Options:
  --blank    Create a minimal Agent instead of the starter project
  --target <target>             Build target (supported: oci)
  --output <directory>          Build output directory
  --host <host>                 Bind host (default: 127.0.0.1)
  --port <port>                 Bind port (default: 7331)
  --local-dev                   Enable authenticated loopback HTTP
  --repository-root <path>      Override Server repository root
  --cors-origin <origin>        Add an exact browser origin
  --allowed-host <host>         Add an accepted public Host
  --trusted-proxy <ip-or-cidr>  Add a trusted TLS terminator source
  --tls-cert <path>             Bun TLS certificate path
  --tls-key <path>              Bun TLS private-key path
  --max-active-runs <count>     Global active Run limit (1-64)
  --continuation-ttl-seconds <seconds>
                                Continuation lifetime (60-2592000)
  --shutdown-timeout-seconds <seconds>
                                Graceful shutdown timeout (1-300)
  -h, --help Show this help
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const command = argv[0];
  if (command === "serve") {
    let options: ReturnType<typeof _serveOptions>;
    try {
      options = _serveOptions(argv.slice(1));
    } catch (error) {
      process.stderr.write(
        `Invalid Agent Server options: ${error instanceof Error ? error.message : "unknown error"}\n`
      );
      return 1;
    }
    try {
      await serveAgentProject(options);
      return 0;
    } catch {
      process.stderr.write(
        "Unable to start Agent Server; verify the project and Server configuration.\n"
      );
      return 1;
    }
  }
  if (command === "build") {
    let options: ReturnType<typeof _buildOptions>;
    try {
      options = _buildOptions(argv.slice(1));
    } catch (error) {
      process.stderr.write(
        `Invalid Agent build options: ${error instanceof Error ? error.message : "unknown error"}\n`
      );
      return 1;
    }
    try {
      const project = await loadAgentProjectManifest(options.projectRoot);
      const result = await createOciBuildContext({
        agentRoot: project.agentRoot,
        output: options.output
      });
      process.stdout.write(
        `Created OCI build context for ${result.artifactFingerprint} at ${result.output}\n`
      );
      return 0;
    } catch {
      process.stderr.write(
        "Unable to build OCI Agent context; verify the project and output path.\n"
      );
      return 1;
    }
  }
  if (command !== "init") {
    process.stderr.write(command ? `Unknown command: ${command}\n\n` : HELP);
    return command ? 1 : 0;
  }
  const positional = argv.slice(1).filter(arg => !arg.startsWith("-"));
  const unknown = argv
    .slice(1)
    .filter(arg => arg.startsWith("-") && arg !== "--blank");
  if (positional.length > 1 || unknown.length > 0) {
    process.stderr.write(`Invalid arguments.\n\n${HELP}`);
    return 1;
  }
  try {
    const root = await scaffoldAgentProject({
      directory: positional[0] ?? process.cwd(),
      template: argv.includes("--blank") ? "blank" : "starter"
    });
    process.stdout.write(`Created LLM Space Agent Project at ${root}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `Unable to create Agent Project: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}

function _buildOptions(argv: string[]) {
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) { break; }
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    if (argument !== "--target" && argument !== "--output") {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  if (positional.length > 1) {
    throw new Error("Too many Agent Project directories");
  }
  if (values.get("--target") !== "oci") {
    throw new Error("--target oci is required");
  }
  const output = values.get("--output");
  if (!output) {
    throw new Error("--output is required");
  }
  return {
    projectRoot: positional[0] ?? process.cwd(),
    output
  };
}

function _serveOptions(argv: string[]) {
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  const flags = new Set(["--local-dev"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      break;
    }
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    if (flags.has(argument)) {
      values.set(argument, ["true"]);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, [...(values.get(argument) ?? []), value]);
    index += 1;
  }
  const known = new Set([
    "--host",
    "--port",
    "--local-dev",
    "--repository-root",
    "--cors-origin",
    "--allowed-host",
    "--trusted-proxy",
    "--tls-cert",
    "--tls-key",
    "--max-active-runs",
    "--continuation-ttl-seconds",
    "--shutdown-timeout-seconds"
  ]);
  const unknown = [...values.keys()].find(key => !known.has(key));
  if (unknown || positional.length > 1) {
    throw new Error(unknown ? `Unknown option: ${unknown}` : "Too many directories");
  }
  const port = Number(_value(
    values,
    "--port",
    "LLM_SPACE_SERVER_PORT",
    "7331"
  ));
  const maxActiveRuns = Number(
    _value(
      values,
      "--max-active-runs",
      "LLM_SPACE_SERVER_MAX_ACTIVE_RUNS",
      "4"
    )
  );
  const continuationTtlSeconds = Number(
    _value(
      values,
      "--continuation-ttl-seconds",
      "LLM_SPACE_SERVER_CONTINUATION_TTL_SECONDS",
      "86400"
    )
  );
  const shutdownTimeoutSeconds = Number(
    _value(
      values,
      "--shutdown-timeout-seconds",
      "LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS",
      "30"
    )
  );
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer from 0 through 65535");
  }
  if (!Number.isInteger(maxActiveRuns) || maxActiveRuns < 1 || maxActiveRuns > 64) {
    throw new Error("--max-active-runs must be an integer from 1 through 64");
  }
  if (
    !Number.isInteger(continuationTtlSeconds)
    || continuationTtlSeconds < 60
    || continuationTtlSeconds > 2_592_000
  ) {
    throw new Error(
      "--continuation-ttl-seconds must be an integer from 60 through 2592000"
    );
  }
  if (
    !Number.isInteger(shutdownTimeoutSeconds)
    || shutdownTimeoutSeconds < 1
    || shutdownTimeoutSeconds > 300
  ) {
    throw new Error(
      "--shutdown-timeout-seconds must be an integer from 1 through 300"
    );
  }
  const localDev = values.has("--local-dev")
    || _environmentBoolean("LLM_SPACE_SERVER_LOCAL_DEV");
  return {
    agentRoot: positional[0] ?? process.cwd(),
    hostname: _value(
      values,
      "--host",
      "LLM_SPACE_SERVER_HOST",
      "127.0.0.1"
    ),
    port,
    localDev,
    repositoryRoot: _value(
      values,
      "--repository-root",
      "LLM_SPACE_SERVER_HOME"
    ),
    allowedOrigins: _values(
      values,
      "--cors-origin",
      "LLM_SPACE_SERVER_CORS_ORIGINS"
    ),
    allowedHosts: _values(
      values,
      "--allowed-host",
      "LLM_SPACE_SERVER_ALLOWED_HOSTS"
    ),
    trustedProxyCidrs: _values(
      values,
      "--trusted-proxy",
      "LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS"
    ),
    tlsCertificatePath: _value(
      values,
      "--tls-cert",
      "LLM_SPACE_SERVER_TLS_CERT"
    ),
    tlsKeyPath: _value(
      values,
      "--tls-key",
      "LLM_SPACE_SERVER_TLS_KEY"
    ),
    maxActiveRuns,
    continuationTtlSeconds,
    shutdownTimeoutSeconds
  };
}

function _value(
  values: ReadonlyMap<string, string[]>,
  option: string,
  environmentName: string,
  fallback: string
): string;
function _value(
  values: ReadonlyMap<string, string[]>,
  option: string,
  environmentName: string
): string | undefined;
function _value(
  values: ReadonlyMap<string, string[]>,
  option: string,
  environmentName: string,
  fallback?: string
): string | undefined {
  return values.get(option)?.at(-1)
    ?? process.env[environmentName]
    ?? fallback;
}

function _values(
  values: ReadonlyMap<string, string[]>,
  option: string,
  environmentName: string
): readonly string[] {
  const configured = values.get(option);
  if (configured) {
    return configured;
  }
  const environmentValue = process.env[environmentName];
  if (!environmentValue) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(environmentValue) as unknown;
  } catch {
    throw new Error(`${environmentName} must be a JSON array of strings`);
  }
  if (
    !Array.isArray(parsed)
    || !parsed.every(value => typeof value === "string")
  ) {
    throw new Error(`${environmentName} must be a JSON array of strings`);
  }
  return parsed;
}

function _environmentBoolean(name: string): boolean {
  const value = process.env[name];
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new Error(`${name} must be true or false`);
}

if (import.meta.main) {
  process.exitCode = await main();
}
