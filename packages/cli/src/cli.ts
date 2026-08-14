#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createPiAcpAgent } from "@llm-space/acp";
import { createAgent, type Agent } from "@llm-space/app/server";
import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { ModelManager } from "@llm-space/runtime/models";

import cliPackage from "../package.json";

import { serveAcpStdio } from "./acp-stdio";

interface DevCommand {
  readonly command: "dev";
  readonly projectRoot: string;
}

interface ExecCommand {
  readonly command: "exec";
  readonly message: string;
  readonly projectRoot: string;
  readonly sessionId?: string;
}

interface AcpCommand {
  readonly command: "acp";
  readonly projectRoot: string;
}

type CliCommand = DevCommand | ExecCommand | AcpCommand;

/** Parses and executes one CLI command without a second execution loop. */
async function _main(): Promise<void> {
  const command = _parseCommand(process.argv.slice(2));
  if (command.command === "dev") {
    await _openStudio(command.projectRoot);
    return;
  }
  if (command.command === "acp") {
    await _serveAcp(command);
    return;
  }
  await _execAgent(command);
}

/** Opens the installed Studio through its project deep-link contract. */
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

/** Executes one Pi operation and writes exactly one final JSON document. */
async function _execAgent(command: ExecCommand): Promise<void> {
  const { agent, projectId } = await _createProjectAgent(command.projectRoot);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Execution cancelled."));
  process.once("SIGINT", cancel);
  try {
    const session =
      command.sessionId === undefined
        ? await agent.createSession({ projectId })
        : await agent.getSession(command.sessionId);
    if (session === undefined) {
      throw new Error(`Session "${command.sessionId}" was not found.`);
    }
    const result = await agent.exec(session.sessionId, {
      messages: [
        {
          role: "user",
          content: command.message,
          timestamp: Date.now(),
        },
      ],
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    process.removeListener("SIGINT", cancel);
    await agent.close();
  }
}

/** Hosts the same App/Pi runtime as an official ACP v2 NDJSON endpoint. */
async function _serveAcp(command: AcpCommand): Promise<void> {
  const { agent } = await _createProjectAgent(command.projectRoot);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("ACP server stopped."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await serveAcpStdio(
      createPiAcpAgent({
        backend: agent.acpBackend,
        version: cliPackage.version,
        name: "llm-space-cli",
        title: "LLM Space CLI",
      }),
      { signal: controller.signal }
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await agent.close();
  }
}

/** Builds one project Agent over the CLI's stable per-project data root. */
async function _createProjectAgent(
  requestedRoot: string
): Promise<{ readonly agent: Agent; readonly projectId: string }> {
  const projectRoot = await realpath(requestedRoot);
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
  return { agent, projectId };
}

function _parseCommand(args: readonly string[]): CliCommand {
  const [name, ...rest] = args;
  if (name === "dev") {
    if (rest.length > 1) throw new Error("Usage: llm-space dev [path]");
    return { command: "dev", projectRoot: resolve(rest[0] ?? ".") };
  }
  if (name === "acp") {
    if (rest.length === 0) {
      return { command: "acp", projectRoot: resolve(".") };
    }
    if (rest.length === 2 && rest[0] === "--project") {
      return { command: "acp", projectRoot: resolve(rest[1]) };
    }
    throw new Error("Usage: llm-space acp [--project <path>]");
  }
  if (name === "exec") {
    let sessionId: string | undefined;
    let projectRoot = resolve(".");
    const messageParts: string[] = [];
    for (let index = 0; index < rest.length; index += 1) {
      const value = rest[index];
      if (value === "--session" || value === "--project") {
        const next = rest[index + 1];
        if (next === undefined) throw new Error(`${value} requires a value.`);
        if (value === "--session") sessionId = next;
        else projectRoot = resolve(next);
        index += 1;
      } else {
        messageParts.push(value ?? "");
      }
    }
    const message = messageParts.join(" ").trim();
    if (message.length === 0) {
      throw new Error(
        'Usage: llm-space exec [--session <id>] [--project <path>] "message"'
      );
    }
    return {
      command: "exec",
      message,
      projectRoot,
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }
  throw new Error("Usage: llm-space <dev|exec|acp> [...options]");
}

await _main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
