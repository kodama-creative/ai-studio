import type { TSchema } from "typebox";

import {
  defineOutputRuntime,
  hasOutputDefinitionBrand
} from "../../internal/authored-output-definitions";

export interface OutputDefinition<TSchemaValue extends TSchema = TSchema> {
  readonly description: string;
  readonly schema: TSchemaValue;
}

export function defineOutput<TSchemaValue extends TSchema>(
  definition: OutputDefinition<TSchemaValue>
): OutputDefinition<TSchemaValue> {
  return defineOutputRuntime(definition);
}

export function isOutputDefinition(value: unknown): value is OutputDefinition {
  return hasOutputDefinitionBrand(value);
}
