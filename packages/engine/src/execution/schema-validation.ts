import type { ToolDefinition } from "@llm-space/agent/tools";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";

const JSON_SCHEMA_VALIDATOR = new Ajv({ allErrors: true, strict: false });
const COMPILED_SCHEMAS = new WeakMap<object, ValidateFunction>();

/** Validates and, for Standard Schema, transforms one tool input/output value. */
export async function validateSchemaValue(
  schema: ToolDefinition["inputSchema"],
  value: unknown,
  options: {
    readonly direction: "input" | "output";
    readonly label: string;
  }
): Promise<unknown> {
  const standard = _asRecordOrUndefined(schema["~standard"]);
  if (standard !== undefined && typeof standard.validate === "function") {
    const result = await (standard.validate as (value: unknown) => unknown)(
      value
    );
    const resultRecord = _asRecordOrUndefined(result);
    const issues = resultRecord?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      throw new Error(
        `${options.label} failed validation: ${_formatIssues(issues)}`
      );
    }
    return resultRecord !== undefined && "value" in resultRecord
      ? resultRecord.value
      : value;
  }

  const jsonSchema = await _resolveJsonSchema(
    schema,
    standard,
    options.direction
  );
  let validate = COMPILED_SCHEMAS.get(jsonSchema);
  validate ??= JSON_SCHEMA_VALIDATOR.compile(jsonSchema as AnySchema);
  COMPILED_SCHEMAS.set(jsonSchema, validate);
  if (!validate(value)) {
    const detail = JSON_SCHEMA_VALIDATOR.errorsText(validate.errors, {
      separator: "; ",
    });
    throw new Error(`${options.label} failed validation: ${detail}`);
  }
  return value;
}

async function _resolveJsonSchema(
  schema: ToolDefinition["inputSchema"],
  standard: Readonly<Record<string, unknown>> | undefined,
  direction: "input" | "output"
): Promise<object> {
  const converters = _asRecordOrUndefined(standard?.jsonSchema);
  const converter = converters?.[direction];
  if (typeof converter === "function") {
    const converted = await (
      converter as (options: { readonly target: string }) => unknown
    )({ target: "draft-2020-12" });
    const record = _asRecordOrUndefined(converted);
    if (record !== undefined) return record;
  }
  return schema;
}

function _formatIssues(issues: readonly unknown[]): string {
  return issues
    .map((issue) => {
      const record = _asRecordOrUndefined(issue);
      return typeof record?.message === "string"
        ? record.message
        : JSON.stringify(issue);
    })
    .join("; ");
}

function _asRecordOrUndefined(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
