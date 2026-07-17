#!/usr/bin/env bun

import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const AUTH_TOKEN = "oci-acceptance-auth-token-with-at-least-thirty-two-bytes";
const FAKE_PROVIDER_KEY = "oci-acceptance-provider-key";
const CONTINUATION_TOKEN = "oci-acceptance-continuation-token-000000000000000000000000";
const PUBLIC_HOST = "agent.example";
const PLATFORMS = ["linux/amd64", "linux/arm64"] as const;

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface ImageInspection {
  readonly Config: {
    readonly Entrypoint?: readonly string[];
    readonly ExposedPorts?: Readonly<Record<string, unknown>>;
    readonly Healthcheck?: { readonly Test?: readonly string[]; };
    readonly Labels?: Readonly<Record<string, string>>;
    readonly StopSignal?: string;
    readonly User?: string;
    readonly Volumes?: Readonly<Record<string, unknown>>;
  };
}

async function _main(argv = process.argv.slice(2)): Promise<void> {
  const context = _contextArgument(argv);
  await _command(["docker", "buildx", "version"]);
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-oci-acceptance-"));
  const suffix = `${process.pid}-${Date.now()}`;
  const tags: string[] = [];
  const volumes: string[] = [];
  const containers: string[] = [];
  try {
    for (const platform of PLATFORMS) {
      const architecture = platform.slice("linux/".length);
      const tag = `llm-space-oci-acceptance:${suffix}-${architecture}`;
      tags.push(tag);
      await _command([
        "docker",
        "buildx",
        "build",
        "--platform",
        platform,
        "--load",
        "--tag",
        tag,
        context
      ]);
      await _inspectImage(tag);
      const volume = `llm-space-oci-${suffix}-${architecture}`;
      volumes.push(volume);
      await _command(["docker", "volume", "create", volume]);
      await _acceptPlatform({
        containers,
        platform,
        tag,
        volume,
        liveProviderKey: process.env.LLM_SPACE_OCI_LIVE_OPENAI_API_KEY
      });
    }
    const primaryTag = tags[0];
    _assert(primaryTag, "The amd64 acceptance image is missing");
    await _acceptFailureModes({
      containers,
      context,
      root,
      tag: primaryTag,
      volumes
    });
    await _acceptImageIndex(context, root, suffix);
    process.stdout.write(
      "OCI acceptance passed for linux/amd64, linux/arm64, and one two-platform image index.\n"
    );
  } finally {
    for (const container of containers.reverse()) {
      await _command(["docker", "rm", "--force", container], true);
    }
    for (const volume of volumes.reverse()) {
      await _command(["docker", "volume", "rm", "--force", volume], true);
    }
    for (const tag of tags.reverse()) {
      await _command(["docker", "image", "rm", "--force", tag], true);
    }
    await rm(root, { force: true, recursive: true });
  }
}

async function _acceptPlatform(options: {
  containers: string[];
  liveProviderKey?: string;
  platform: typeof PLATFORMS[number];
  tag: string;
  volume: string;
}): Promise<void> {
  const architecture = options.platform.slice("linux/".length);
  const first = `llm-space-oci-${process.pid}-${architecture}-first`;
  const second = `llm-space-oci-${process.pid}-${architecture}-second`;
  options.containers.push(first, second);
  await _startContainer({
    name: first,
    platform: options.platform,
    providerKey: options.liveProviderKey ?? FAKE_PROVIDER_KEY,
    tag: options.tag,
    volume: options.volume
  });
  const firstBaseUrl = await _readyBaseUrl(first);
  const firstSession = await _createSession(firstBaseUrl, "persistent-session");
  await _stopAndAssert(first);
  await _command(["docker", "rm", first]);

  await _startContainer({
    name: second,
    platform: options.platform,
    providerKey: options.liveProviderKey ?? FAKE_PROVIDER_KEY,
    tag: options.tag,
    volume: options.volume
  });
  const secondBaseUrl = await _readyBaseUrl(second);
  const restored = await _createSession(secondBaseUrl, "persistent-session");
  _assert(restored.sessionId === firstSession.sessionId, "Session did not persist");

  const competing = `llm-space-oci-${process.pid}-${architecture}-writer`;
  options.containers.push(competing);
  const competition = await _command([
    "docker",
    "run",
    "--name",
    competing,
    "--platform",
    options.platform,
    "-v",
    `${options.volume}:/var/lib/llm-space`,
    ..._environmentArguments(options.liveProviderKey ?? FAKE_PROVIDER_KEY),
    options.tag
  ], true, 30_000);
  _assert(competition.exitCode !== 0, "A second writer acquired the Server volume");
  _assert(!competition.stderr.includes(AUTH_TOKEN), "Server credential leaked to stderr");

  if (options.liveProviderKey && options.platform === "linux/amd64") {
    await _liveRun(secondBaseUrl, restored.sessionId);
    process.stdout.write("Optional live Pi provider smoke passed.\n");
  } else if (options.platform === "linux/amd64") {
    process.stdout.write("Optional live Pi provider smoke skipped: no credential provided.\n");
  }
  await _stopAndAssert(second);
}

async function _acceptFailureModes(options: {
  containers: string[];
  context: string;
  root: string;
  tag: string;
  volumes: string[];
}): Promise<void> {
  const badRoot = path.join(options.root, "unwritable");
  await mkdir(badRoot, { mode: 0o700 });
  await chmod(badRoot, 0o000);
  const permissions = `llm-space-oci-${process.pid}-permissions`;
  options.containers.push(permissions);
  const permissionResult = await _command([
    "docker",
    "run",
    "--name",
    permissions,
    "--platform",
    "linux/amd64",
    "-v",
    `${badRoot}:/var/lib/llm-space`,
    ..._environmentArguments(FAKE_PROVIDER_KEY),
    options.tag
  ], true, 30_000);
  await chmod(badRoot, 0o700);
  _assert(permissionResult.exitCode !== 0, "Unwritable storage became ready");

  const mismatchContext = path.join(options.root, "mismatch-context");
  await cp(options.context, mismatchContext, { recursive: true });
  const artifactPath = path.join(mismatchContext, "artifact.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    fingerprints: { sources: { entries: Array<{ fingerprint: string; }>; }; };
  };
  const firstSource = artifact.fingerprints.sources.entries[0];
  _assert(firstSource, "The artifact has no source fingerprint entry");
  firstSource.fingerprint = "0".repeat(64);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const mismatchTag = `llm-space-oci-acceptance:${process.pid}-mismatch`;
  await _command([
    "docker",
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--load",
    "--tag",
    mismatchTag,
    mismatchContext
  ]);
  const mismatchVolume = `llm-space-oci-${process.pid}-mismatch`;
  options.volumes.push(mismatchVolume);
  await _command(["docker", "volume", "create", mismatchVolume]);
  const mismatch = `llm-space-oci-${process.pid}-mismatch`;
  options.containers.push(mismatch);
  const mismatchResult = await _command([
    "docker",
    "run",
    "--name",
    mismatch,
    "-v",
    `${mismatchVolume}:/var/lib/llm-space`,
    ..._environmentArguments(FAKE_PROVIDER_KEY),
    mismatchTag
  ], true, 30_000);
  _assert(mismatchResult.exitCode !== 0, "Mismatched artifact became ready");
  _assert(!mismatchResult.stderr.includes(AUTH_TOKEN), "Mismatch error leaked a credential");
  await _command(["docker", "image", "rm", "--force", mismatchTag], true);
}

async function _acceptImageIndex(
  context: string,
  root: string,
  suffix: string
): Promise<void> {
  const archive = path.join(root, "agent-index.tar");
  const extracted = path.join(root, "agent-index");
  await mkdir(extracted);
  await _command([
    "docker",
    "buildx",
    "build",
    "--platform",
    PLATFORMS.join(","),
    "--output",
    `type=oci,dest=${archive}`,
    context
  ]);
  await _command(["tar", "-xf", archive, "-C", extracted]);
  const rootIndex = JSON.parse(
    await readFile(path.join(extracted, "index.json"), "utf8")
  ) as OciIndex;
  const platforms = new Set<string>();
  await _collectPlatforms(extracted, rootIndex, platforms);
  for (const platform of PLATFORMS) {
    _assert(platforms.has(platform), `OCI index is missing ${platform}`);
  }
  process.stdout.write(`Verified two-platform OCI index ${suffix}.\n`);
}

interface OciIndex {
  readonly manifests?: ReadonlyArray<{
    readonly digest?: string;
    readonly mediaType?: string;
    readonly platform?: { readonly architecture?: string; readonly os?: string; };
  }>;
}

async function _collectPlatforms(
  root: string,
  index: OciIndex,
  platforms: Set<string>
): Promise<void> {
  for (const manifest of index.manifests ?? []) {
    const os = manifest.platform?.os;
    const architecture = manifest.platform?.architecture;
    if (os && architecture && os !== "unknown" && architecture !== "unknown") {
      platforms.add(`${os}/${architecture}`);
    }
    if (manifest.mediaType?.includes("image.index") && manifest.digest) {
      const [algorithm, digest] = manifest.digest.split(":");
      if (algorithm && digest) {
        const child = JSON.parse(
          await readFile(path.join(root, "blobs", algorithm, digest), "utf8")
        ) as OciIndex;
        await _collectPlatforms(root, child, platforms);
      }
    }
  }
}

async function _inspectImage(tag: string): Promise<void> {
  const result = await _command(["docker", "image", "inspect", tag]);
  const image = (JSON.parse(result.stdout) as ImageInspection[])[0];
  _assert(image, `Unable to inspect ${tag}`);
  const config = image.Config;
  _assert(config.User === "1000:1000", "Image runtime user is not 1000:1000");
  _assert(Boolean(config.Volumes?.["/var/lib/llm-space"]), "Image volume is missing");
  _assert(Boolean(config.ExposedPorts?.["7331/tcp"]), "Image port is missing");
  _assert(config.StopSignal === "SIGTERM", "Image stop signal is not SIGTERM");
  _assert(
    JSON.stringify(config.Entrypoint) === JSON.stringify([
      "bun",
      "/opt/llm-space/bootstrap.mjs"
    ]),
    "Image entrypoint is not fixed"
  );
  _assert(
    config.Healthcheck?.Test?.includes("/opt/llm-space/healthcheck.mjs") ?? false,
    "Image readiness healthcheck is missing"
  );
  _assert(
    /^[0-9a-f]{64}$/.test(
      config.Labels?.["io.llm-space.agent-artifact.fingerprint"] ?? ""
    ),
    "Image Agent artifact label is missing"
  );
  _assert(
    config.Labels?.["org.opencontainers.image.base.digest"]
    === "sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f",
    "Image base digest label is not locked"
  );
  const history = await _command([
    "docker",
    "history",
    "--no-trunc",
    "--format",
    "{{json .CreatedBy}}",
    tag
  ]);
  const imageEvidence = `${result.stdout}\n${history.stdout}`;
  _assert(!imageEvidence.includes(AUTH_TOKEN), "Server credential is present in image data");
  _assert(!imageEvidence.includes(FAKE_PROVIDER_KEY), "Provider key is present in image data");
}

async function _startContainer(options: {
  name: string;
  platform: string;
  providerKey: string;
  tag: string;
  volume: string;
}): Promise<void> {
  await _command([
    "docker",
    "run",
    "--detach",
    "--name",
    options.name,
    "--platform",
    options.platform,
    "--publish",
    "127.0.0.1::7331",
    "--volume",
    `${options.volume}:/var/lib/llm-space`,
    ..._environmentArguments(options.providerKey),
    options.tag
  ]);
}

function _environmentArguments(providerKey: string): string[] {
  return [
    "--env",
    `LLM_SPACE_SERVER_ALLOWED_HOSTS=${JSON.stringify([PUBLIC_HOST])}`,
    "--env",
    `LLM_SPACE_SERVER_AUTH_KEYS=${JSON.stringify([{
      issuer: "oci-acceptance",
      principalId: "ci",
      principalType: "service",
      token: AUTH_TOKEN
    }])}`,
    "--env",
    `LLM_SPACE_SERVER_TRUSTED_PROXY_CIDRS=${JSON.stringify(["0.0.0.0/0"])}`,
    "--env",
    "LLM_SPACE_SERVER_SHUTDOWN_TIMEOUT_SECONDS=8",
    "--env",
    `OPENAI_API_KEY=${providerKey}`
  ];
}

async function _readyBaseUrl(name: string): Promise<string> {
  const portOutput = await _command(["docker", "port", name, "7331/tcp"]);
  const port = /:(\d+)\s*$/.exec(portOutput.stdout)?.[1];
  _assert(port, `Container ${name} has no published Server port`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const inspection = await _command([
      "docker",
      "inspect",
      "--format",
      "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
      name
    ], true);
    if (inspection.stdout.trim() === "running healthy") {
      const response = await fetch(`${baseUrl}/v1/ready`, {
        headers: _requestHeaders({})
      });
      if (response.status === 200) {
        return baseUrl;
      }
    }
    if (inspection.stdout.startsWith("exited")) {
      const logs = await _command(["docker", "logs", name], true);
      throw new Error(`Container ${name} exited before readiness: ${logs.stderr}`);
    }
    await Bun.sleep(500);
  }
  throw new Error(`Container ${name} did not become healthy`);
}

async function _createSession(
  baseUrl: string,
  idempotencyKey: string
): Promise<{ sessionId: string; }> {
  const response = await fetch(`${baseUrl}/v1/sessions`, {
    method: "POST",
    headers: _requestHeaders({
      "idempotency-key": idempotencyKey,
      "llm-space-next-continuation": CONTINUATION_TOKEN
    })
  });
  _assert(response.status === 201, `Session creation returned ${response.status}`);
  const session = await response.json() as { sessionId?: unknown; };
  _assert(typeof session.sessionId === "string", "Session response has no ID");
  return { sessionId: session.sessionId };
}

async function _liveRun(baseUrl: string, sessionId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/v1/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: _requestHeaders({
      "content-type": "application/json",
      "idempotency-key": "oci-live-run",
      "llm-space-continuation": CONTINUATION_TOKEN
    }),
    body: JSON.stringify({
      input: { type: "text", text: "Reply with exactly OCI_LIVE_OK." }
    })
  });
  _assert(response.status === 202, `Live Run creation returned ${response.status}`);
  const run = await response.json() as { runId?: unknown; };
  _assert(typeof run.runId === "string", "Live Run response has no ID");
  const events = await fetch(
    `${baseUrl}/v1/sessions/${sessionId}/runs/${run.runId}/events`,
    {
      headers: _requestHeaders({
        "llm-space-continuation": CONTINUATION_TOKEN
      })
    }
  );
  _assert(events.status === 200, `Live Run events returned ${events.status}`);
  const stream = await events.text();
  _assert(
    stream.includes('"type":"runTerminal","outcome":"completed"'),
    "Live Pi Run did not complete"
  );
}

function _requestHeaders(
  additions: Readonly<Record<string, string>>
): Headers {
  return new Headers({
    authorization: `Bearer ${AUTH_TOKEN}`,
    host: PUBLIC_HOST,
    "x-forwarded-proto": "https",
    ...additions
  });
}

async function _stopAndAssert(name: string): Promise<void> {
  await _command(["docker", "stop", "--time", "10", name]);
  const inspection = await _command([
    "docker",
    "inspect",
    "--format",
    "{{.State.ExitCode}}",
    name
  ]);
  _assert(inspection.stdout.trim() === "0", `${name} did not drain cleanly`);
}

async function _command(
  command: readonly string[],
  allowFailure = false,
  timeoutMs = 120_000
): Promise<CommandResult> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => { child.kill(); }, timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  clearTimeout(timeout);
  const result = { exitCode, stdout, stderr };
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`${command.slice(0, 3).join(" ")} failed: ${stderr.trim()}`);
  }
  return result;
}

function _contextArgument(argv: readonly string[]): string {
  const index = argv.indexOf("--context");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || argv.length !== 2) {
    throw new Error("Usage: bun oci-acceptance.ts --context <directory>");
  }
  return path.resolve(value);
}

function _assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

if (import.meta.main) {
  await _main();
}
