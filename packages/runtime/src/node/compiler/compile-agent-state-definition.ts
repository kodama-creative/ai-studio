import { createHash } from "node:crypto";
import { Compile } from "typebox/compile";

import type { StateDefinition } from "../../public/definitions/state";
import type { JsonValue } from "../../public/definitions/tool";
import type { CompiledAgentStateDefinition } from "../../runtime/agent/agent-project-snapshot";

const STATE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z][a-z0-9]*)*$/;

export function compileAgentStateDefinition(
  definition: StateDefinition,
  sourcePath: string
): CompiledAgentStateDefinition {
  if (
    definition.name.length > 128
    || !STATE_NAME_PATTERN.test(definition.name)
  ) {
    throw new TypeError(
      `State name must be a qualified lowercase name up to 128 characters: ${definition.name}`
    );
  }
  if (definition.name.startsWith("llm-space.")) {
    throw new TypeError("State names beginning with llm-space. are reserved");
  }
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
    throw new TypeError(
      `State "${definition.name}" version must be a positive integer`
    );
  }
  _assertJsonValue(definition.initial, definition.name, new WeakSet());
  if (!Compile(definition.schema).Check(definition.initial)) {
    throw new TypeError(
      `State "${definition.name}" initial value does not match its schema`
    );
  }
  return {
    name: definition.name,
    version: definition.version,
    schema: definition.schema,
    schemaFingerprint: createHash("sha256")
      .update(_canonicalJson(definition.schema))
      .digest("hex"),
    initial: structuredClone(definition.initial) as JsonValue,
    sourcePath
  };
}

function _assertJsonValue(
  value: unknown,
  name: string,
  ancestors: WeakSet<object>
): void {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) { return; }
    throw new TypeError(`State "${name}" initial value must be finite JSON`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`State "${name}" initial value must be plain JSON`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`State "${name}" initial value must not be circular`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`State "${name}" initial value must be plain JSON`);
  }
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    _assertJsonValue(child, name, ancestors);
  }
  ancestors.delete(value);
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
  throw new TypeError("Non-JSON value");
}
