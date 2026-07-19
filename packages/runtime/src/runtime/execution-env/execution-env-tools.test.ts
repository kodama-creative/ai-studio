import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileInfo,
  NodeExecutionEnv,
  ok
} from "@earendil-works/pi-agent-core/node";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "bun:test";

import { createExecutionEnvTool } from "./create-execution-env-tool";
import { ExecutionEnvUnavailableError } from "./execution-env-unavailable-error";
import { AgentRuntime } from "../agent/agent-runtime";
import { createCompiledExecutionEnvTool } from "../agent/create-compiled-execution-env-tool";
import { InMemorySessionStore } from "../harness/in-memory-session-store";

import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root => rm(root, {
    force: true,
    recursive: true
  })));
});

describe("ExecutionEnv-backed authored tools", () => {
  test("runs the same read, write, and bash contracts against Node and fake envs", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-execution-env-"));
    ROOTS.push(root);
    const node = new NodeExecutionEnv({ cwd: root });
    const fake = _fakeExecutionEnv();

    for (const env of [node, fake.env]) {
      const write = _tool("write", env);
      const read = _tool("read", env);
      const bash = _tool("bash", env);
      const written = await _execute(write, {
        path: "nested/value.txt",
        content: "one\ntwo\nthree"
      });
      expect(_text(written)).toContain("Successfully wrote 13 bytes");
      expect(_text(await _execute(write, {
        path: "nested/unicode.txt",
        content: "你好"
      }))).toContain("Successfully wrote 6 bytes");
      const readResult = await _execute(read, {
        path: "nested/value.txt",
        offset: 2,
        limit: 1
      });
      expect(_text(readResult)).toBe(
        "two\n\n[1 more lines in file. Use offset=3 to continue.]"
      );
      const updates: string[] = [];
      const bashResult = await _execute(
        bash,
        { command: "printf out; printf err >&2; exit 7" },
        undefined,
        update => { updates.push(_text(update)); }
      );
      expect(_text(bashResult)).toContain("out");
      expect(_text(bashResult)).toContain("err");
      expect(_text(bashResult)).toContain("Command exited with code 7");
      expect(updates.length).toBeGreaterThan(0);
    }

    await symlink(join(root, "nested", "value.txt"), join(root, "value-link"));
    fake.link("value-link", "nested/value.txt");
    expect(_text(await _execute(_tool("read", node), {
      path: "value-link"
    }))).toContain("one\ntwo\nthree");
    expect(_text(await _execute(_tool("read", fake.env), {
      path: "value-link"
    }))).toContain("one\ntwo\nthree");

    const large = await _execute(_tool("bash", fake.env), {
      command: "large-output"
    });
    expect(large.details).toMatchObject({
      truncated: true,
      fullOutputPath: expect.stringContaining("/sandbox/bash-")
    });
    expect(_text(large)).toContain("Full output:");

    expect(fake.cleanupCalls()).toBe(0);
    await fake.env.cleanup();
    expect(fake.cleanupCalls()).toBe(1);
    await node.cleanup();
  });

  test("preserves Pi abort and timeout errors without retrying", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-execution-errors-"));
    ROOTS.push(root);
    const node = new NodeExecutionEnv({ cwd: root });
    const fake = _fakeExecutionEnv();
    for (const env of [node, fake.env]) {
      const aborted = new AbortController();
      aborted.abort();
      expect(await _rejection(_execute(
        _tool("read", env),
        { path: "missing.txt" },
        aborted.signal
      ))).toMatchObject({ code: "aborted", name: "FileError" });

      const cancelled = await _execute(
        _tool("bash", env),
        { command: "sleep 1" },
        aborted.signal
      );
      expect(cancelled.details).toMatchObject({
        cancelled: true,
        exitCode: undefined
      });
      expect(_text(cancelled)).toContain("Command cancelled");

      expect(await _rejection(_execute(
        _tool("bash", env),
        { command: "sleep 1", timeout: 0.01 }
      ))).toMatchObject({ code: "timeout", name: "ExecutionError" });
    }
    expect(fake.executions()).toBe(2);
    expect(fake.cleanupCalls()).toBe(0);
    await node.cleanup();
  });

  test("fails before Pi only when an effective helper lacks Host authority", async () => {
    const tool = createCompiledExecutionEnvTool("read", "tools/read.ts");
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project(tool)
    });
    expect(await _rejection(runtime.createSession({
      capabilityPolicy: _policy(["tool:tools/read.ts"]),
      context: _context("required")
    }))).toBeInstanceOf(ExecutionEnvUnavailableError);

    const filtered = await runtime.createSession({
      activeToolNames: [],
      capabilityPolicy: _policy(["tool:tools/read.ts"]),
      context: _context("filtered")
    });
    expect(filtered.capabilitySnapshot?.tools).toEqual([]);
  });

  test("persists only helper capability identity and rehydrates with Host authority", async () => {
    const fake = _fakeExecutionEnv();
    const store = new InMemorySessionStore();
    const tool = createCompiledExecutionEnvTool("read", "tools/read.ts");
    const runtime = new AgentRuntime({ models: _models(), project: _project(tool) });
    const input = {
      capabilityPolicy: _policy(["tool:tools/read.ts"]),
      context: _context("persisted"),
      executionEnv: fake.env,
      sessionStore: store
    };

    const first = await runtime.createSession(input);
    const second = await runtime.createSession(input);

    expect(second.capabilitySnapshot).toEqual(first.capabilitySnapshot);
    expect(second.capabilitySnapshot?.tools).toEqual([expect.objectContaining({
      contributionId: "tool:tools/read.ts",
      executionEnvToolKind: "read",
      name: "read",
      requiresExecutionEnv: true,
      sourcePath: "tools/read.ts"
    })]);
    expect(JSON.stringify(await store.load("persisted"))).not.toContain(
      "/sandbox"
    );
    expect(fake.cleanupCalls()).toBe(0);
  });
});

function _tool(
  kind: "bash" | "read" | "write",
  env: ExecutionEnv
): PreparedAgentTool {
  return createExecutionEnvTool({
    env,
    tool: createCompiledExecutionEnvTool(kind, `tools/${kind}.ts`)
  });
}

async function _execute(
  tool: PreparedAgentTool,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: Parameters<Extract<
    PreparedAgentTool,
    { kind: "executable"; }
  >["execute"]>[3]
) {
  if (tool.kind !== "executable") {
    throw new Error("Expected executable helper");
  }
  const outcome = await tool.execute("call", input, signal, onUpdate);
  if (outcome.type !== "completed") {
    throw new Error("Expected completed helper result");
  }
  return outcome.result;
}

function _text(result: {
  content: Array<{ text?: string; type: string; }>;
}): string {
  return result.content
    .filter(item => item.type === "text")
    .map(item => item.text ?? "")
    .join("\n");
}

function _fakeExecutionEnv() {
  const files = new Map<string, string>();
  const links = new Map<string, string>();
  let cleanupCalls = 0;
  let executions = 0;
  const absolute = (value: string) => (value.startsWith("/")
    ? posix.normalize(value)
    : posix.resolve("/sandbox", value));
  const target = (value: string) => links.get(value) ?? value;
  const aborted = (signal: AbortSignal | undefined, path?: string) =>
    (signal?.aborted
      ? err<never, FileError>(new FileError("aborted", "aborted", path))
      : null);
  const env: ExecutionEnv = {
    cwd: "/sandbox",
    async absolutePath(value, signal) {
      return aborted(signal, value) ?? ok(absolute(value));
    },
    async joinPath(parts, signal) {
      return aborted(signal) ?? ok(posix.join(...parts));
    },
    async readTextFile(value, signal) {
      const failed = aborted(signal, value);
      if (failed) { return failed; }
      const content = files.get(absolute(target(value)));
      return content === undefined
        ? err(new FileError("not_found", "missing", absolute(value)))
        : ok(content);
    },
    async readTextLines(value, options) {
      const read = await env.readTextFile(value, options?.abortSignal);
      return read.ok
        ? ok(read.value.split("\n").slice(0, options?.maxLines))
        : read;
    },
    async readBinaryFile(value, signal) {
      const read = await env.readTextFile(value, signal);
      return read.ok ? ok(new TextEncoder().encode(read.value)) : read;
    },
    async writeFile(value, content, signal) {
      const failed = aborted(signal, value);
      if (failed) { return failed; }
      files.set(
        absolute(target(value)),
        typeof content === "string" ? content : new TextDecoder().decode(content)
      );
      return ok(undefined);
    },
    async appendFile(value, content, signal) {
      const failed = aborted(signal, value);
      if (failed) { return failed; }
      const key = absolute(target(value));
      files.set(key, (files.get(key) ?? "") + (
        typeof content === "string" ? content : new TextDecoder().decode(content)
      ));
      return ok(undefined);
    },
    async fileInfo(value, signal) {
      const failed = aborted(signal, value);
      if (failed) { return failed; }
      const addressed = absolute(value);
      if (links.has(value)) {
        return ok(_fileInfo(addressed, "symlink", 0));
      }
      const content = files.get(addressed);
      return content === undefined
        ? err(new FileError("not_found", "missing", addressed))
        : ok(_fileInfo(addressed, "file", content.length));
    },
    async listDir(_value, signal) {
      return aborted(signal) ?? ok([]);
    },
    async canonicalPath(value, signal) {
      return aborted(signal, value) ?? ok(absolute(target(value)));
    },
    async exists(value, signal) {
      const failed = aborted(signal, value);
      if (failed) { return failed; }
      return ok(files.has(absolute(target(value))));
    },
    async createDir(_value, options) {
      return aborted(options?.abortSignal) ?? ok(undefined);
    },
    async remove(value, options) {
      const failed = aborted(options?.abortSignal, value);
      if (failed) { return failed; }
      files.delete(absolute(target(value)));
      return ok(undefined);
    },
    async createTempDir(prefix, signal) {
      return aborted(signal) ?? ok(`/sandbox/${prefix ?? "tmp-"}dir`);
    },
    async createTempFile(options) {
      const failed = aborted(options?.abortSignal);
      if (failed) { return failed; }
      const file = `/sandbox/${options?.prefix ?? ""}output${options?.suffix ?? ""}`;
      files.set(file, "");
      return ok(file);
    },
    async exec(_command, options) {
      executions += 1;
      if (options?.abortSignal?.aborted) {
        return err(new ExecutionError("aborted", "aborted"));
      }
      if (_command === "sleep 1") {
        return err(new ExecutionError("timeout", `timeout:${options?.timeout}`));
      }
      if (_command === "large-output") {
        const output = "line\n".repeat(15_000);
        options?.onStdout?.(output);
        return ok({ stdout: output, stderr: "", exitCode: 0 });
      }
      options?.onStdout?.("out");
      options?.onStderr?.("err");
      return ok({ stdout: "out", stderr: "err", exitCode: 7 });
    },
    async cleanup() {
      cleanupCalls += 1;
    }
  };
  return {
    env,
    cleanupCalls: () => cleanupCalls,
    executions: () => executions,
    link: (name: string, to: string) => links.set(name, to)
  };
}

function _fileInfo(
  path: string,
  kind: FileInfo["kind"],
  size: number
): FileInfo {
  return {
    name: posix.basename(path),
    path,
    kind,
    size,
    mtimeMs: 0
  };
}

function _models() {
  const model: Model<"fake"> = {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
  const stream = () => createAssistantMessageEventStream();
  const provider = createProvider({
    id: "fake",
    auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: { stream, streamSimple: stream }
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}

function _project(tool: ReturnType<typeof createCompiledExecutionEnvTool>):
AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Use the selected helper.",
    tools: [tool],
    connections: [],
    resources: {},
    diagnostics: [],
    fingerprint: "execution-env-project"
  };
}

function _policy(toolContributions: string[]) {
  return {
    connectionContributions: [],
    modelOptions: {},
    models: [{ provider: "fake", id: "fake-model" }],
    reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
    toolContributions
  };
}

function _context(id: string) {
  const principal = {
    issuer: "test",
    principalId: "test",
    principalType: "runtime" as const
  };
  return {
    id,
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: `turn-${id}`, sequence: 1 }
  };
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}
