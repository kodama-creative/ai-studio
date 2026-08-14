import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import {
  PROTOCOL_VERSION,
  client,
  methods,
  ndJsonStream,
  type ClientConnection,
  type InitializeResponse,
  type UpdateSessionNotification,
} from "@llm-space/acp";

import { stopProcess } from "./process-utils";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";
import { buildRemoteAcpArgs } from "./ssh-command";

export interface SshAcpConnectionHandle {
  readonly connection: ClientConnection;
  readonly initialization: InitializeResponse;
  stop(): Promise<void>;
}

export interface OpenSshAcpConnectionOptions {
  /** Absolute path interpreted on the remote host. */
  readonly projectRoot?: string;
  readonly signal?: AbortSignal;
  readonly onSessionUpdate?: (update: UpdateSessionNotification) => void;
  /** @internal Test seam. */
  readonly spawnProcess?: (
    command: string,
    args: readonly string[]
  ) => ChildProcess;
}

/** Opens official ACP v2 directly over `ssh <host> llm-space acp` stdio. */
export async function openSshAcpConnection(
  config: SshRemoteRuntimeConfig,
  options: OpenSshAcpConnectionOptions = {}
): Promise<SshAcpConnectionHandle> {
  options.signal?.throwIfAborted();
  const args = buildRemoteAcpArgs({
    config,
    ...(options.projectRoot === undefined
      ? {}
      : { projectRoot: options.projectRoot }),
  });
  const child =
    options.spawnProcess?.("ssh", args) ??
    spawn("ssh", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  const stderr = _collectStderr(child);
  const stdin = child.stdin;
  const stdout = child.stdout;
  if (stdin === null || stdout === null) {
    await stopProcess(child);
    throw new Error("SSH ACP requires piped stdin and stdout.");
  }
  const app = client({ name: "llm-space-desktop-ssh" }).onNotification(
    methods.client.session.update,
    ({ params }) => options.onSessionUpdate?.(params)
  );
  const connection = app.connect(
    ndJsonStream(
      _writableBytes(stdin),
      _readableBytes(stdout)
    )
  );
  let stopPromise: Promise<void> | undefined;
  const stop = (reason?: unknown): Promise<void> => {
    stopPromise ??= (async () => {
      options.signal?.removeEventListener("abort", abort);
      await _endStdin(stdin);
      const exited = await _waitForExit(child, 1_000);
      connection.close(reason);
      if (!exited) await stopProcess(child);
    })();
    return stopPromise;
  };
  const abort = () => {
    void stop(options.signal?.reason);
  };
  if (options.signal?.aborted) {
    await stop(options.signal.reason);
    options.signal.throwIfAborted();
  } else {
    options.signal?.addEventListener("abort", abort, { once: true });
  }
  let initialization: InitializeResponse;
  try {
    initialization = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "llm-space-desktop-ssh", version: "1" },
    });
  } catch (error) {
    await stop(error);
    options.signal?.throwIfAborted();
    const detail = stderr().trim();
    throw new Error(
      detail.length === 0
        ? "Unable to initialize the SSH ACP endpoint."
        : `Unable to initialize the SSH ACP endpoint: ${detail}`,
      { cause: error }
    );
  }
  if (options.signal?.aborted) {
    await stop(options.signal.reason);
    options.signal.throwIfAborted();
  }

  return {
    connection,
    initialization,
    stop,
  };
}

/** Ends ACP input and lets the remote host close its runtime and SQLite leases. */
function _endStdin(stream: Writable): Promise<void> {
  if (stream.destroyed || stream.writableEnded) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => resolve();
    stream.once("error", finish);
    stream.end(finish);
  });
}

/** Waits briefly for a clean remote exit before the TERM/KILL fallback. */
function _waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", exited);
      resolve(false);
    }, timeoutMs);
    const exited = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", exited);
  });
}

/** Captures bounded diagnostics on stderr while stdout stays ACP-only. */
function _collectStderr(child: ChildProcess): () => string {
  let output = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
  });
  return () => output;
}

/** Adapts child stdout while preserving byte chunks and EOF semantics. */
function _readableBytes(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream as AsyncIterable<Buffer | string>) {
          controller.enqueue(
            typeof chunk === "string"
              ? new TextEncoder().encode(chunk)
              : new Uint8Array(chunk)
          );
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      stream.destroy(
        reason instanceof Error ? reason : new Error("ACP input cancelled.")
      );
    },
  });
}

/** Adapts child stdin and waits for each chunk to enter the OS write buffer. */
function _writableBytes(stream: Writable): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        stream.write(chunk, (error) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => stream.end(resolve));
    },
    abort(reason) {
      stream.destroy(
        reason instanceof Error ? reason : new Error("ACP output aborted.")
      );
    },
  });
}
