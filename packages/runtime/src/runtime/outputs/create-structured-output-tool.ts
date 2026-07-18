import { Compile } from "typebox/compile";

import { StructuredOutputError } from "./structured-output-error";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../../shared/structured-output";

import type { CompiledAgentOutputDefinition } from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";
import type { RuntimeStructuredOutputResult } from "../harness/runtime-run";

export function createStructuredOutputTool(input: {
  readonly definition: CompiledAgentOutputDefinition;
  readonly maxBytes: number;
  readonly onFailure: (error: StructuredOutputError) => void;
  readonly onResult: (result: RuntimeStructuredOutputResult) => void;
}): PreparedAgentTool {
  const validator = Compile(input.definition.schema);
  return {
    kind: "executable",
    manualAutomatic: true,
    provenance: {
      contributionId: "runtime:structured-output",
      schemaFingerprint: input.definition.schemaFingerprint,
      sourcePath: input.definition.sourcePath
    },
    definition: {
      name: STRUCTURED_OUTPUT_TOOL_NAME,
      label: "Structured output",
      description: `${input.definition.description}\nSubmit the final result exactly once. This call must be the only tool call in its assistant message.`,
      parameters: input.definition.schema,
      executionMode: "sequential"
    },
    async execute(_toolCallId, value) {
      try {
        _assertJsonValue(value, new WeakSet());
        if (!validator.Check(value)) {
          throw new StructuredOutputError(
            "structured_output_invalid",
            `Structured output does not match contract "${input.definition.name}"`
          );
        }
        const canonical = _canonicalJson(value);
        if (new TextEncoder().encode(canonical).byteLength > input.maxBytes) {
          throw new StructuredOutputError(
            "structured_output_too_large",
            `Structured output exceeds the ${input.maxBytes}-byte Host limit`
          );
        }
        const result: RuntimeStructuredOutputResult = {
          contract: input.definition.name,
          schemaFingerprint: input.definition.schemaFingerprint,
          value: structuredClone(value) as RuntimeStructuredOutputResult["value"]
        };
        input.onResult(result);
        return {
          type: "completed",
          result: {
            content: [{ type: "text", text: canonical }],
            details: { structuredOutput: result },
            terminate: true
          }
        };
      } catch (error) {
        const structured = error instanceof StructuredOutputError
          ? error
          : new StructuredOutputError(
            "structured_output_invalid",
            error instanceof Error ? error.message : String(error)
          );
        input.onFailure(structured);
        throw structured;
      }
    }
  };
}

function _assertJsonValue(value: unknown, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) { return; }
    throw new TypeError("Structured output must contain only finite JSON numbers");
  }
  if (typeof value !== "object") {
    throw new TypeError("Structured output must be plain JSON data");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Structured output must not be circular");
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Structured output must be plain JSON data");
  }
  ancestors.add(value);
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    _assertJsonValue(child, ancestors);
  }
  ancestors.delete(value);
}

function _canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") { return JSON.stringify(value); }
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${_canonicalJson(record[key])}`)
    .join(",")}}`;
}
