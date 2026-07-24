import {
  DEFAULT_MAX_BYTES,
  executeShellWithCapture,
  formatSize,
  truncateHead,
  truncateTail
} from "@earendil-works/pi-agent-core";

import type {
  AgentToolResult,
  ExecutionEnv,
  ShellCaptureResult,
  TruncationResult
} from "@earendil-works/pi-agent-core";

import type { CompiledProjectTool } from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";

export function createExecutionEnvTool(input: {
  readonly env?: ExecutionEnv;
  readonly tool: CompiledProjectTool;
}): PreparedAgentTool {
  const kind = input.tool.executionEnvToolKind;
  if (!kind) {
    throw new TypeError("Compiled tool is not an ExecutionEnv helper");
  }
  const { approval, execute: _execute, ...definition } = input.tool;
  return {
    ...(approval ? { approval } : {}),
    kind: "executable",
    definition,
    executionEnvToolKind: kind,
    provenance: {
      contributionId: `tool:${input.tool.sourcePath ?? input.tool.name}`,
      ...(input.tool.sourcePath ? { sourcePath: input.tool.sourcePath } : {})
    },
    async execute(...args) {
      const env = input.env;
      if (!env) {
        throw new Error("ExecutionEnv helper executed without Host authority");
      }
      const [, value, signal, onUpdate] = args;
      const result = kind === "read"
        ? await _read(env, value as ReadInput, signal)
        : kind === "write"
          ? await _write(env, value as WriteInput, signal)
          : await _bash(env, value as BashInput, signal, onUpdate);
      return { type: "completed", result };
    }
  };
}

interface ReadInput {
  readonly limit?: number;
  readonly offset?: number;
  readonly path: string;
}

interface WriteInput {
  readonly content: string;
  readonly path: string;
}

interface BashInput {
  readonly command: string;
  readonly timeout?: number;
}

async function _read(
  env: ExecutionEnv,
  input: ReadInput,
  signal?: AbortSignal
): Promise<AgentToolResult<{ truncation?: TruncationResult; } | undefined>> {
  const read = await env.readTextFile(input.path, signal);
  if (!read.ok) { throw read.error; }
  const lines = read.value.split("\n");
  const start = input.offset ? Math.max(0, input.offset - 1) : 0;
  if (start >= lines.length) {
    throw new RangeError(
      `Offset ${input.offset} is beyond end of file (${lines.length} lines total)`
    );
  }
  const end = input.limit === undefined
    ? lines.length
    : Math.min(lines.length, start + Math.max(0, input.limit));
  const selected = lines.slice(start, end).join("\n");
  const truncation = truncateHead(selected);
  const startLine = start + 1;
  let text = truncation.content;
  if (truncation.firstLineExceedsLimit) {
    text = `[Line ${startLine} exceeds ${formatSize(DEFAULT_MAX_BYTES)}. Use bash to read a bounded byte range.]`;
  } else if (truncation.truncated) {
    const endLine = startLine + truncation.outputLines - 1;
    text += `\n\n[Showing lines ${startLine}-${endLine} of ${lines.length}. Use offset=${endLine + 1} to continue.]`;
  } else if (end < lines.length) {
    text += `\n\n[${lines.length - end} more lines in file. Use offset=${end + 1} to continue.]`;
  }
  return {
    content: [{ type: "text", text }],
    details: truncation.truncated ? { truncation } : undefined
  };
}

async function _write(
  env: ExecutionEnv,
  input: WriteInput,
  signal?: AbortSignal
): Promise<AgentToolResult<undefined>> {
  const written = await env.writeFile(input.path, input.content, signal);
  if (!written.ok) { throw written.error; }
  const byteLength = new TextEncoder().encode(input.content).byteLength;
  return {
    content: [{
      type: "text",
      text: `Successfully wrote ${byteLength} bytes to ${input.path}`
    }],
    details: undefined
  };
}

async function _bash(
  env: ExecutionEnv,
  input: BashInput,
  signal: AbortSignal | undefined,
  onUpdate: Parameters<CompiledProjectTool["execute"]>[3]
): Promise<AgentToolResult<ShellCaptureResult>> {
  let streamed = "";
  const captured = await executeShellWithCapture(env, input.command, {
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
    ...(signal ? { abortSignal: signal } : {}),
    onChunk: chunk => {
      streamed += chunk;
      const partial = truncateTail(streamed);
      if (partial.truncated) { streamed = partial.content; }
      onUpdate?.({
        content: [{ type: "text", text: partial.content }],
        details: undefined
      });
    }
  });
  if (!captured.ok) { throw captured.error; }
  const details = captured.value;
  let text = details.output || "(no output)";
  if (details.truncated && details.fullOutputPath) {
    text += `\n\n[Output truncated. Full output: ${details.fullOutputPath}]`;
  }
  if (details.cancelled) {
    text += "\n\n[Command cancelled]";
  } else if (details.exitCode !== 0 && details.exitCode !== undefined) {
    text += `\n\n[Command exited with code ${details.exitCode}]`;
  }
  return { content: [{ type: "text", text }], details };
}
