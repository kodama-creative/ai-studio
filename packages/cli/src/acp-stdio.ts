import { ndJsonStream, type AgentApp } from "@llm-space/acp";

export interface AcpStdioOptions {
  readonly input?: ReadableStream<Uint8Array>;
  readonly output?: WritableStream<Uint8Array>;
  readonly signal?: AbortSignal;
}

/** Serves one official ACP v2 connection over newline-delimited stdio bytes. */
export async function serveAcpStdio(
  app: AgentApp,
  options: AcpStdioOptions = {}
): Promise<void> {
  const connection = app.connect(
    ndJsonStream(
      options.output ?? _stdoutStream(),
      options.input ?? Bun.stdin.stream()
    )
  );
  const abort = () => connection.close(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await connection.closed;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

/** Adapts process stdout without ever mixing protocol logs into the byte stream. */
function _stdoutStream(): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        process.stdout.write(chunk, (error) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        });
      });
    },
  });
}
