export interface DockerCommandOptions {
  readonly onStderr?: (chunk: string) => void;
  readonly onStdout?: (chunk: string) => void;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
}

export interface DockerCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface DockerCommandRunner {
  run(
    arguments_: readonly string[],
    options?: DockerCommandOptions
  ): Promise<DockerCommandResult>;
}

export class BunDockerCommandRunner implements DockerCommandRunner {
  async run(
    arguments_: readonly string[],
    options: DockerCommandOptions = {}
  ): Promise<DockerCommandResult> {
    const child = Bun.spawn(["docker", ...arguments_], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    if (options.stdin !== undefined) {
      await child.stdin.write(options.stdin);
    }
    await child.stdin.end();
    const abort = () => { child.kill(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        _readStream(child.stdout, options.onStdout),
        _readStream(child.stderr, options.onStderr)
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

async function _readStream(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) { break; }
    const chunk = decoder.decode(value, { stream: true });
    output += chunk;
    onChunk?.(chunk);
  }
  const tail = decoder.decode();
  output += tail;
  if (tail) { onChunk?.(tail); }
  return output;
}
