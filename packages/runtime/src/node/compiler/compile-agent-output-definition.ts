import { createHash } from "node:crypto";
import { Compile } from "typebox/compile";

import { STRUCTURED_OUTPUT_TOOL_NAME } from "../../shared/structured-output";

import type { OutputDefinition } from "../../public/definitions/output";
import type { CompiledAgentOutputDefinition } from "../../runtime/agent/agent-project-snapshot";

export function compileAgentOutputDefinition(
  definition: OutputDefinition,
  name: string,
  sourcePath: string
): CompiledAgentOutputDefinition {
  if (name === STRUCTURED_OUTPUT_TOOL_NAME) {
    throw new TypeError(`Output name "${name}" is reserved`);
  }
  if (
    typeof definition.description !== "string"
    || definition.description.trim().length === 0
  ) {
    throw new TypeError(`Output "${name}" requires a non-empty description`);
  }
  const keys = Object.keys(definition);
  if (keys.length !== 2 || !keys.includes("description") || !keys.includes("schema")) {
    throw new TypeError(
      `Output "${name}" accepts only description and schema`
    );
  }
  Compile(definition.schema);
  const canonicalSchema = _canonicalJson(definition.schema);
  return {
    name,
    description: definition.description.trim(),
    schema: definition.schema,
    schemaFingerprint: createHash("sha256")
      .update(canonicalSchema)
      .digest("hex"),
    sourcePath
  };
}

function _canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) { throw new TypeError("Non-finite JSON number"); }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${_canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Output schema must be plain JSON data");
}
