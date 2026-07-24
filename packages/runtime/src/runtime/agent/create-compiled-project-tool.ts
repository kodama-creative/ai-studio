import { Compile } from "typebox/compile";

import type { CompiledProjectTool } from "./agent-project-snapshot";
import type { ToolDefinition } from "../../public/definitions/tool";
import type { AgentSessionContext } from "../../shared/agent-session-context";

export function createCompiledProjectTool(input: {
  readonly definition: ToolDefinition;
  readonly getSession: () => AgentSessionContext;
  readonly name: string;
  readonly sourcePath?: string;
}): CompiledProjectTool {
  const inputValidator = Compile(input.definition.inputSchema);
  const outputValidator = input.definition.outputSchema
    ? Compile(input.definition.outputSchema)
    : null;
  return {
    name: input.name,
    label: input.name,
    description: input.definition.description,
    parameters: input.definition.inputSchema,
    ...(input.definition.approval
      ? { approval: input.definition.approval }
      : {}),
    outputSchema: input.definition.outputSchema,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    async execute(toolCallId, value, signal) {
      if (!inputValidator.Check(value)) {
        throw new TypeError(`Invalid input for tool "${input.name}"`);
      }
      const output = await input.definition.execute(value, {
        abortSignal: signal ?? new AbortController().signal,
        callId: toolCallId,
        toolName: input.name,
        get session() { return input.getSession(); }
      });
      if (outputValidator && !outputValidator.Check(output)) {
        throw new TypeError(`Invalid output from tool "${input.name}"`);
      }
      return {
        content: [{ type: "text", text: _serializeToolOutput(output, input.name) }],
        details: output
      };
    }
  };
}

function _serializeToolOutput(output: unknown, name: string): string {
  _assertJsonValue(output, name, new WeakSet());
  if (typeof output === "string") { return output; }
  const text = JSON.stringify(output);
  if (text === undefined) {
    throw new TypeError(`Tool "${name}" returned a non-JSON value`);
  }
  return text;
}

function _assertJsonValue(
  value: unknown,
  name: string,
  ancestors: WeakSet<object>
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) { return; }
    throw new TypeError(`Tool "${name}" returned a non-JSON number`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Tool "${name}" returned a non-JSON value`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`Tool "${name}" returned a circular value`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Tool "${name}" returned a non-plain object`);
  }
  ancestors.add(value);
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    _assertJsonValue(child, name, ancestors);
  }
  ancestors.delete(value);
}
