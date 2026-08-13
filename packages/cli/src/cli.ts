#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createAgent } from "@llm-space/app/server";
import { getLlmSpaceHomePath } from "@llm-space/core/server";
import type { RunFrame } from "@llm-space/engine";
import { ModelManager } from "@llm-space/runtime/models";

interface DevCommand {
  readonly command: "dev";
  readonly projectRoot: string;
}

interface RunCommand {
  readonly command: "run";
  readonly message: string;
  readonly projectRoot: string;
  readonly sessionId?: string;
}

type CliCommand = DevCommand | RunCommand;

/** Parse and execute one headless CLI command. */
async function _main(): Promise<void> {
  const command = _parseCommand(process.argv.slice(2));
  if (command.command === "dev") {
    await _openStudio(command.projectRoot);
    return;
  }
  await _runAgent(command);
}

/** Open the installed Studio through its project deep-link contract. */
async function _openStudio(projectRoot: string): Promise<void> {
  const root = await realpath(projectRoot);
  const url = `llm-space://studio/open?project=${encodeURIComponent(root)}`;
  const child = Bun.spawn(["open", url], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      "Unable to open LLM Space Studio. Install the desktop application and try again."
    );
  }
}

/** Execute one user input in a durable Session and render its Run events. */
async function _runAgent(command: RunCommand): Promise<void> {
  const projectRoot = await realpath(command.projectRoot);
  const projectId = createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 16);
  const modelManager = new ModelManager();
  const agent = await createAgent({
    projectRoot,
    dataRoot: join(getLlmSpaceHomePath(), "cli", "projects", projectId),
    models: () => modelManager.getAvailableModels(),
    resolveConnection: ({ providerId }) =>
      modelManager.resolveConnection({ providerId }),
    runtimeServices: {},
  });
  let runId: string | undefined;
  let sessionId = command.sessionId;
  const cancel = () => {
    if (sessionId !== undefined && runId !== undefined) {
      void agent.cancelRun(sessionId, runId);
    }
  };
  process.once("SIGINT", cancel);
  try {
    const session =
      sessionId === undefined
        ? await agent.createSession()
        : await agent.getSession(sessionId);
    if (session === undefined) {
      throw new Error(`Session "${sessionId}" was not found.`);
    }
    sessionId = session.id;
    const run = await agent.startRun(session.id, {
      message: {
        id: `message_${crypto.randomUUID().replaceAll("-", "")}`,
        role: "user",
        content: [{ type: "text", text: command.message }],
      },
    });
    runId = run.id;
    await _renderRun(agent.events(session.id, run.id, { follow: true }));
    process.stdout.write(`\nsessionId=${session.id} runId=${run.id}\n`);
  } finally {
    process.removeListener("SIGINT", cancel);
    await agent.close();
  }
}

/** Render only incremental assistant text; durable ids are printed separately. */
async function _renderRun(frames: AsyncIterable<RunFrame>): Promise<void> {
  for await (const frame of frames) {
    if (frame.type === "event" && frame.event.type === "message.delta") {
      process.stdout.write(frame.event.delta);
    }
  }
}

function _parseCommand(args: readonly string[]): CliCommand {
  const [name, ...rest] = args;
  if (name === "dev") {
    if (rest.length > 1) throw new Error("Usage: llm-space dev [path]");
    return { command: "dev", projectRoot: resolve(rest[0] ?? ".") };
  }
  if (name === "run") {
    let sessionId: string | undefined;
    let projectRoot = resolve(".");
    const messageParts: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const value = rest[index];
      if (value === "--session" || value === "--project") {
        const next = rest[index + 1];
        if (next === undefined) throw new Error(`${value} requires a value.`);
        if (value === "--session") sessionId = next;
        else projectRoot = resolve(next);
        index++;
      } else {
        messageParts.push(value);
      }
    }
    const message = messageParts.join(" ").trim();
    if (message.length === 0) {
      throw new Error(
        'Usage: llm-space run [--session <id>] [--project <path>] "message"'
      );
    }
    return {
      command: "run",
      message,
      projectRoot,
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }
  throw new Error("Usage: llm-space <dev|run> [...options]");
}

await _main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
