import {
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileInfo,
  ok,
  type Result,
  type ShellExecOptions
} from "@earendil-works/pi-agent-core/node";

import { DOCKER_SANDBOX_HELPER_PATH } from "./docker-sandbox-image";

import type { DockerCommandRunner } from "./docker-command-runner";

interface HelperError {
  readonly code?: string;
  readonly kind?: "execution" | "file";
  readonly message?: string;
  readonly path?: string;
}

type HelperMessage =
  | { readonly chunk: string; readonly type: "stderr" | "stdout"; }
  | {
    readonly error?: HelperError;
    readonly ok: boolean;
    readonly type: "result";
    readonly value?: unknown;
  };

export class DockerExecutionEnv implements ExecutionEnv {
  readonly cwd = "/workspace";

  constructor(
    private readonly _runner: DockerCommandRunner,
    private readonly _container: string
  ) {}

  async absolutePath(value: string, abortSignal?: AbortSignal) {
    return this._file<string>({ operation: "absolutePath", path: value }, abortSignal);
  }

  async joinPath(parts: string[], abortSignal?: AbortSignal) {
    return this._file<string>({ operation: "joinPath", parts }, abortSignal);
  }

  async readTextFile(value: string, abortSignal?: AbortSignal) {
    return this._file<string>({ operation: "readTextFile", path: value }, abortSignal);
  }

  async readTextLines(
    value: string,
    options: { abortSignal?: AbortSignal; maxLines?: number; } = {}
  ) {
    return this._file<string[]>({
      operation: "readTextLines",
      path: value,
      ...(options.maxLines === undefined ? {} : { maxLines: options.maxLines })
    }, options.abortSignal);
  }

  async readBinaryFile(
    value: string,
    abortSignal?: AbortSignal
  ): Promise<Result<Uint8Array, FileError>> {
    const read = await this._file<{ contentBase64: string; }>({
      operation: "readBinaryFile",
      path: value
    }, abortSignal);
    return read.ok
      ? ok(new Uint8Array(Buffer.from(read.value.contentBase64, "base64")))
      : read;
  }

  async writeFile(
    value: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal
  ) {
    return this._file<undefined>({
      operation: "writeFile",
      path: value,
      ...(typeof content === "string"
        ? { contentText: content }
        : { contentBase64: Buffer.from(content).toString("base64") })
    }, abortSignal);
  }

  async appendFile(
    value: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal
  ) {
    return this._file<undefined>({
      operation: "appendFile",
      path: value,
      ...(typeof content === "string"
        ? { contentText: content }
        : { contentBase64: Buffer.from(content).toString("base64") })
    }, abortSignal);
  }

  async fileInfo(value: string, abortSignal?: AbortSignal) {
    return this._file<FileInfo>({ operation: "fileInfo", path: value }, abortSignal);
  }

  async listDir(value: string, abortSignal?: AbortSignal) {
    return this._file<FileInfo[]>({ operation: "listDir", path: value }, abortSignal);
  }

  async canonicalPath(value: string, abortSignal?: AbortSignal) {
    return this._file<string>({ operation: "canonicalPath", path: value }, abortSignal);
  }

  async exists(value: string, abortSignal?: AbortSignal) {
    return this._file<boolean>({ operation: "exists", path: value }, abortSignal);
  }

  async createDir(
    value: string,
    options: { abortSignal?: AbortSignal; recursive?: boolean; } = {}
  ) {
    return this._file<undefined>({
      operation: "createDir",
      path: value,
      recursive: options.recursive !== false
    }, options.abortSignal);
  }

  async remove(
    value: string,
    options: {
      abortSignal?: AbortSignal;
      force?: boolean;
      recursive?: boolean;
    } = {}
  ) {
    return this._file<undefined>({
      operation: "remove",
      path: value,
      recursive: options.recursive === true,
      force: options.force === true
    }, options.abortSignal);
  }

  async createTempDir(prefix = "tmp-", abortSignal?: AbortSignal) {
    return this._file<string>({ operation: "createTempDir", prefix }, abortSignal);
  }

  async createTempFile(
    options: {
      abortSignal?: AbortSignal;
      prefix?: string;
      suffix?: string;
    } = {}
  ) {
    return this._file<string>({
      operation: "createTempFile",
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(options.suffix === undefined ? {} : { suffix: options.suffix })
    }, options.abortSignal);
  }

  async exec(
    command: string,
    options: ShellExecOptions = {}
  ): Promise<Result<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }, ExecutionError>> {
    if (options.abortSignal?.aborted) {
      return err(new ExecutionError("aborted", "Sandbox command was aborted"));
    }
    const commandId = globalThis.crypto.randomUUID();
    let callbackError: Error | null = null;
    const abort = () => { void this._abortCommand(commandId); };
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    try {
      const terminal = await this._invoke({
        operation: "exec",
        commandId,
        command,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.timeout === undefined ? {} : { timeout: options.timeout })
      }, options.abortSignal, event => {
        if (callbackError) { return; }
        try {
          if (event.type === "stdout") { options.onStdout?.(event.chunk); }
          if (event.type === "stderr") { options.onStderr?.(event.chunk); }
        } catch (error) {
          callbackError = error instanceof Error
            ? error
            : new Error(String(error));
          void this._abortCommand(commandId);
        }
      });
      if (callbackError) {
        return err(new ExecutionError(
          "callback_error",
          "Sandbox output callback failed",
          callbackError
        ));
      }
      if (options.abortSignal?.aborted) {
        return err(new ExecutionError("aborted", "Sandbox command was aborted"));
      }
      if (!terminal.ok) {
        return err(new ExecutionError(
          _executionCode(terminal.error?.code),
          terminal.error?.message || "Sandbox command failed"
        ));
      }
      return ok(terminal.value as {
        exitCode: number;
        stderr: string;
        stdout: string;
      });
    } catch (error) {
      return err(new ExecutionError(
        options.abortSignal?.aborted ? "aborted" : "unknown",
        options.abortSignal?.aborted
          ? "Sandbox command was aborted"
          : "Sandbox command failed",
        error instanceof Error ? error : new Error(String(error))
      ));
    } finally {
      options.abortSignal?.removeEventListener("abort", abort);
    }
  }

  async cleanup(): Promise<void> {
    // SandboxProvider owns the Session lifecycle.
  }

  private async _file<T>(
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Result<T, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Sandbox file operation was aborted"));
    }
    try {
      const terminal = await this._invoke(input, signal);
      if (signal?.aborted) {
        return err(new FileError("aborted", "Sandbox file operation was aborted"));
      }
      if (!terminal.ok) {
        return err(new FileError(
          _fileCode(terminal.error?.code),
          terminal.error?.message || "Sandbox file operation failed",
          terminal.error?.path
        ));
      }
      return ok(terminal.value as T);
    } catch (error) {
      return err(new FileError(
        signal?.aborted ? "aborted" : "unknown",
        signal?.aborted
          ? "Sandbox file operation was aborted"
          : "Sandbox file operation failed",
        typeof input.path === "string" ? input.path : undefined,
        error instanceof Error ? error : new Error(String(error))
      ));
    }
  }

  private async _abortCommand(commandId: string): Promise<void> {
    await this._runner.run([
      "exec",
      "--interactive",
      "--user",
      "1000:1000",
      this._container,
      "bun",
      DOCKER_SANDBOX_HELPER_PATH
    ], {
      stdin: JSON.stringify({ operation: "abort", commandId })
    }).catch(() => undefined);
  }

  private async _invoke(
    input: unknown,
    signal?: AbortSignal,
    onEvent?: (event: Extract<HelperMessage, { chunk: string; }>) => void
  ): Promise<Extract<HelperMessage, { type: "result"; }>> {
    const parser = new HelperLineParser(onEvent);
    const result = await this._runner.run([
      "exec",
      "--interactive",
      "--user",
      "1000:1000",
      this._container,
      "bun",
      DOCKER_SANDBOX_HELPER_PATH
    ], {
      stdin: JSON.stringify(input),
      signal,
      onStdout: chunk => { parser.push(chunk); }
    });
    parser.finish(result.stdout);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "Sandbox helper failed");
    }
    const terminal = parser.terminal;
    if (!terminal) { throw new Error("Sandbox helper returned no result"); }
    return terminal;
  }
}

class HelperLineParser {
  private _buffer = "";
  private _sawChunks = false;
  private readonly _onEvent?: (
    event: Extract<HelperMessage, { chunk: string; }>
  ) => void;

  terminal: Extract<HelperMessage, { type: "result"; }> | null = null;

  constructor(onEvent?: (
    event: Extract<HelperMessage, { chunk: string; }>
  ) => void) {
    this._onEvent = onEvent;
  }

  push(chunk: string): void {
    this._sawChunks = true;
    this._buffer += chunk;
    this._drain(false);
  }

  finish(fullOutput: string): void {
    if (!this._sawChunks) { this._buffer += fullOutput; }
    this._drain(true);
  }

  private _drain(flush: boolean): void {
    const lines = this._buffer.split("\n");
    this._buffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) { continue; }
      const message = JSON.parse(line) as HelperMessage;
      if (message.type === "result") { this.terminal = message; } else {
        this._onEvent?.(message);
      }
    }
    if (flush && this._buffer.trim()) {
      const message = JSON.parse(this._buffer) as HelperMessage;
      if (message.type === "result") { this.terminal = message; } else {
        this._onEvent?.(message);
      }
      this._buffer = "";
    }
  }
}

function _fileCode(code: string | undefined): FileError["code"] {
  return code === "aborted"
    || code === "not_found"
    || code === "permission_denied"
    || code === "not_directory"
    || code === "is_directory"
    || code === "invalid"
    || code === "not_supported"
    ? code
    : "unknown";
}

function _executionCode(code: string | undefined): ExecutionError["code"] {
  return code === "aborted"
    || code === "timeout"
    || code === "shell_unavailable"
    || code === "spawn_error"
    || code === "callback_error"
    ? code
    : "unknown";
}
