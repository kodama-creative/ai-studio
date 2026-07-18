import type { JsonValue, ToolContext } from "../public/definitions/tool";

export type DynamicToolStep = (
  closureVariables: Record<string, JsonValue>,
  input: unknown,
  context: ToolContext
) => JsonValue | Promise<JsonValue>;

export interface DynamicToolRuntimeMetadata {
  readonly closureVariables: Record<string, JsonValue>;
  readonly stepId: string;
}

export type DynamicToolSteps = Readonly<Record<string, DynamicToolStep>>;
