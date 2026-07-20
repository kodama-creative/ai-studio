import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BunDockerCommandRunner } from "./docker-command-runner";
import { DockerExecutionEnv } from "./docker-execution-env";
import {
  DOCKER_SANDBOX_FILE,
  DOCKER_SANDBOX_HELPER_PATH,
  DOCKER_SANDBOX_HELPER_SOURCE
} from "./docker-sandbox-image";
import { SandboxWorkspaceLostError } from "../../runtime/sandbox/sandbox-workspace-lost-error";
import { hasControlCharacter } from "../has-control-character";

import type {
  DockerCommandResult,
  DockerCommandRunner
} from "./docker-command-runner";

export {
  BunDockerCommandRunner,
  type DockerCommandOptions,
  type DockerCommandResult,
  type DockerCommandRunner
} from "./docker-command-runner";
import type {
  CompiledSandboxWorkspaceFile
} from "../../runtime/agent/agent-project-snapshot";
import type {
  SandboxAttachmentInput,
  SandboxProvider,
  SandboxProviderReadiness,
  SandboxProviderSession,
  StagedSandboxAttachment
} from "../../runtime/sandbox/sandbox-provider";

const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TURN_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const IMAGE_FINGERPRINT = createHash("sha256")
  .update(DOCKER_SANDBOX_FILE)
  .update(DOCKER_SANDBOX_HELPER_SOURCE)
  .digest("hex");
const IMAGE = `llm-space/sandbox-v1:${IMAGE_FINGERPRINT.slice(0, 16)}`;

export class DockerSandboxProvider implements SandboxProvider {
  private readonly _runner: DockerCommandRunner;

  constructor(options: { runner?: DockerCommandRunner; } = {}) {
    this._runner = options.runner ?? new BunDockerCommandRunner();
  }

  async readiness(): Promise<SandboxProviderReadiness> {
    try {
      const result = await this._runner.run([
        "version",
        "--format",
        "{{.Server.Version}}"
      ]);
      return result.exitCode === 0 && result.stdout.trim()
        ? { state: "ready" }
        : {
          state: "unavailable",
          message: result.stderr.trim() || "Docker Engine is unavailable"
        };
    } catch (error) {
      return {
        state: "unavailable",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async acquire(input: {
    readonly expectedExisting?: boolean;
    readonly seed: readonly CompiledSandboxWorkspaceFile[];
    readonly sessionId: string;
  }): Promise<SandboxProviderSession> {
    _assertSeed(input.seed);
    const readiness = await this.readiness();
    if (readiness.state !== "ready") { throw new Error(readiness.message); }
    await this._ensureImage();
    const names = _resourceNames(input.sessionId);
    const seedFingerprint = _seedFingerprint(input.seed);
    const volumeExists = (await this._runner.run([
      "volume", "inspect", names.volume
    ])).exitCode === 0;
    if (!volumeExists && input.expectedExisting) {
      throw new SandboxWorkspaceLostError();
    }
    if (volumeExists && input.expectedExisting !== true) {
      throw new SandboxWorkspaceLostError();
    }
    const newVolume = !volumeExists;
    if (newVolume) {
      await this._runRequired([
        "volume",
        "create",
        "--label",
        `llm-space.sandbox-seed=${seedFingerprint}`,
        names.volume
      ]);
    } else {
      const existingFingerprint = await this._runner.run([
        "volume",
        "inspect",
        "--format",
        "{{ index .Labels \"llm-space.sandbox-seed\" }}",
        names.volume
      ]);
      if (
        existingFingerprint.exitCode !== 0
        || existingFingerprint.stdout.trim() !== seedFingerprint
      ) {
        throw new SandboxWorkspaceLostError();
      }
    }
    const containerExists = (await this._runner.run([
      "container", "inspect", names.container
    ])).exitCode === 0;
    try {
      if (!containerExists) {
        await this._runRequired([
          "create",
          "--name",
          names.container,
          "--network",
          "none",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,noexec",
          "--user",
          "1000:1000",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--mount",
          `type=volume,src=${names.volume},dst=/workspace`,
          "--label",
          `llm-space.sandbox-session=${names.key}`,
          IMAGE
        ]);
      }
      await this._runRequired(["start", names.container]);
      if (newVolume) {
        await _invokeSandboxHelper(this._runner, names.container, {
          operation: "seed",
          files: input.seed
        });
      }
    } catch (error) {
      if (newVolume) {
        await this._runner.run(["rm", "--force", names.container]);
        await this._runner.run(["volume", "rm", "--force", names.volume]);
      }
      throw error;
    }
    return new DockerSandboxSession(
      this._runner,
      input.sessionId,
      names.container
    );
  }

  async stop(sessionId: string): Promise<void> {
    const { container } = _resourceNames(sessionId);
    const result = await this._runner.run(["stop", "--time", "8", container]);
    if (result.exitCode !== 0 && !_notFound(result)) {
      throw new Error(result.stderr.trim() || "Unable to stop Sandbox");
    }
  }

  async delete(sessionId: string): Promise<void> {
    const names = _resourceNames(sessionId);
    const container = await this._runner.run([
      "rm", "--force", names.container
    ]);
    if (container.exitCode !== 0 && !_notFound(container)) {
      throw new Error(container.stderr.trim() || "Unable to delete Sandbox");
    }
    const volume = await this._runner.run([
      "volume", "rm", "--force", names.volume
    ]);
    if (volume.exitCode !== 0 && !_notFound(volume)) {
      throw new Error(volume.stderr.trim() || "Unable to delete Sandbox workspace");
    }
  }

  private async _ensureImage(): Promise<void> {
    if ((await this._runner.run(["image", "inspect", IMAGE])).exitCode === 0) {
      return;
    }
    const root = await mkdtemp(path.join(tmpdir(), "llm-space-sandbox-image-"));
    try {
      await Promise.all([
        writeFile(path.join(root, "Dockerfile"), DOCKER_SANDBOX_FILE, "utf8"),
        writeFile(
          path.join(root, "sandbox-helper.mjs"),
          DOCKER_SANDBOX_HELPER_SOURCE,
          "utf8"
        )
      ]);
      await this._runRequired([
        "build",
        "--pull=false",
        "--tag",
        IMAGE,
        root
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private async _runRequired(arguments_: readonly string[]): Promise<void> {
    const result = await this._runner.run(arguments_);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || `Docker ${arguments_[0]} failed`
      );
    }
  }
}

class DockerSandboxSession implements SandboxProviderSession {
  readonly executionEnv: DockerExecutionEnv;

  constructor(
    private readonly _runner: DockerCommandRunner,
    readonly sessionId: string,
    private readonly _container: string
  ) {
    this.executionEnv = new DockerExecutionEnv(_runner, _container);
  }

  async discardTurn(input: { readonly turnId: string; }): Promise<void> {
    await _invokeSandboxHelper(this._runner, this._container, {
      operation: "discardTurn",
      turnId: input.turnId
    });
  }

  async stageTurn(input: {
    readonly attachments: readonly SandboxAttachmentInput[];
    readonly turnId: string;
  }): Promise<readonly StagedSandboxAttachment[]> {
    _assertAttachments(input.attachments);
    return _invokeSandboxHelper(this._runner, this._container, {
      operation: "stageTurn",
      turnId: input.turnId,
      attachments: input.attachments.map(attachment => ({
        id: attachment.id,
        name: attachment.name,
        fingerprint: attachment.fingerprint,
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        contentBase64: Buffer.from(attachment.content).toString("base64")
      }))
    }) as Promise<readonly StagedSandboxAttachment[]>;
  }

  async workspaceManifest(): Promise<readonly string[]> {
    return _invokeSandboxHelper(
      this._runner,
      this._container,
      { operation: "manifest" }
    ) as Promise<readonly string[]>;
  }
}

async function _invokeSandboxHelper(
  runner: DockerCommandRunner,
  container: string,
  input: unknown
): Promise<unknown> {
  const result = await runner.run([
    "exec",
    "--interactive",
    "--user",
    "1000:1000",
    container,
    "bun",
    DOCKER_SANDBOX_HELPER_PATH
  ], { stdin: JSON.stringify(input) });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Sandbox helper failed");
  }
  const terminal = result.stdout.trim().split("\n")
    .map(line => JSON.parse(line) as {
      error?: { message?: string; };
      ok?: boolean;
      type?: string;
      value?: unknown;
    })
    .findLast(message => message.type === "result");
  if (!terminal?.ok) {
    throw new Error(terminal?.error?.message || "Sandbox helper failed");
  }
  return terminal.value;
}

function _resourceNames(sessionId: string): {
  container: string;
  key: string;
  volume: string;
} {
  const key = createHash("sha256").update(sessionId).digest("hex")
    .slice(0, 24);
  return {
    key,
    container: `llm-space-sandbox-${key}`,
    volume: `llm-space-sandbox-workspace-${key}`
  };
}

function _seedFingerprint(seed: readonly CompiledSandboxWorkspaceFile[]): string {
  return createHash("sha256").update(JSON.stringify(seed.map(file => ({
    path: file.path,
    size: file.size,
    fingerprint: file.fingerprint
  })))).digest("hex");
}

function _assertAttachments(
  attachments: readonly SandboxAttachmentInput[]
): void {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new TypeError("A Turn supports at most 20 attachments");
  }
  let total = 0;
  const names = new Set<string>();
  for (const attachment of attachments) {
    if (
      !attachment.name
      || attachment.name !== path.posix.basename(attachment.name)
      || attachment.name.includes("\\")
      || hasControlCharacter(attachment.name)
      || new TextEncoder().encode(attachment.name).byteLength > 240
    ) {
      throw new TypeError(`Invalid attachment name: ${attachment.name}`);
    }
    if (names.has(attachment.name)) {
      throw new TypeError(`Duplicate attachment name: ${attachment.name}`);
    }
    names.add(attachment.name);
    if (attachment.content.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new TypeError(`Attachment exceeds 25 MiB: ${attachment.name}`);
    }
    const fingerprint = createHash("sha256")
      .update(attachment.content)
      .digest("hex");
    if (fingerprint !== attachment.fingerprint) {
      throw new TypeError(`Attachment fingerprint mismatch: ${attachment.name}`);
    }
    total += attachment.content.byteLength;
    if (total > MAX_TURN_ATTACHMENT_BYTES) {
      throw new TypeError("Turn attachments exceed 100 MiB");
    }
  }
}

function _assertSeed(seed: readonly CompiledSandboxWorkspaceFile[]): void {
  if (seed.length > 1_000) {
    throw new TypeError("Sandbox workspace supports at most 1000 files");
  }
  let total = 0;
  for (const file of seed) {
    const content = Buffer.from(file.contentBase64, "base64");
    total += content.byteLength;
    if (content.byteLength !== file.size) {
      throw new TypeError(`Sandbox seed size mismatch: ${file.path}`);
    }
    if (content.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new TypeError(`Sandbox seed exceeds 25 MiB: ${file.path}`);
    }
    if (total > MAX_TURN_ATTACHMENT_BYTES) {
      throw new TypeError("Sandbox workspace exceeds 100 MiB");
    }
    if (
      createHash("sha256").update(content).digest("hex")
      !== file.fingerprint
    ) {
      throw new TypeError(`Sandbox seed fingerprint mismatch: ${file.path}`);
    }
  }
}

function _notFound(result: DockerCommandResult): boolean {
  return /no such (?:container|volume)/i.test(result.stderr);
}
