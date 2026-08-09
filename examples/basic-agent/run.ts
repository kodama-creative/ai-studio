#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";

import { createBasicAgentLocalHost } from "./local-host";

interface CliOptions {
  readonly message?: string;
  readonly sessionId?: string;
}

async function _main(): Promise<void> {
  const options = _parseArgs(process.argv.slice(2));
  const host = await createBasicAgentLocalHost({
    ...(options.sessionId === undefined
      ? {}
      : { sessionId: options.sessionId }),
    write: (value) => process.stdout.write(value),
  });
  process.stdout.write(`Session: ${host.sessionId}\n`);
  let interrupted = false;
  const readline =
    options.message === undefined
      ? createInterface({ input: process.stdin, output: process.stdout })
      : undefined;
  let cancellation = Promise.resolve();
  const promptAbort = new AbortController();
  const cancel = () => {
    interrupted = true;
    promptAbort.abort();
    readline?.close();
    cancellation = host.cancel();
  };
  process.once("SIGINT", cancel);

  if (options.message !== undefined) {
    await host.send(options.message);
    await cancellation;
    process.stdout.write("\n");
    process.removeListener("SIGINT", cancel);
    if (interrupted) process.exitCode = 130;
    return;
  }

  if (readline === undefined) return;
  process.stdout.write('Type a message, or "/exit" to quit.\n');
  try {
    while (!interrupted) {
      let message: string;
      try {
        message = await readline.question("> ", {
          signal: promptAbort.signal,
        });
      } catch (error) {
        if (interrupted) break;
        throw error;
      }
      if (message.trim() === "/exit") return;
      if (message.trim().length === 0) continue;
      await host.send(message);
      process.stdout.write("\n");
    }
  } finally {
    readline.close();
    await cancellation;
    process.removeListener("SIGINT", cancel);
    if (interrupted) process.exitCode = 130;
  }
}

function _parseArgs(args: readonly string[]): CliOptions {
  let message: string | undefined;
  let sessionId: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--message" || value === "--session") {
      const next = args[index + 1];
      if (next === undefined) throw new Error(`${value} requires a value.`);
      if (value === "--message") message = next;
      else sessionId = next;
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return {
    ...(message === undefined ? {} : { message }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

await _main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
