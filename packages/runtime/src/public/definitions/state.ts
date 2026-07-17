import type { Static, TSchema } from "typebox";

import {
  defineStateRuntime,
  hasStateDefinitionBrand
} from "../../internal/authored-state-definitions";

export interface StateHandle<TValue> {
  get(): TValue;
  update(updater: (current: TValue) => TValue): void;
}

export interface StateDefinition<TSchemaValue extends TSchema = TSchema>
  extends StateHandle<Static<TSchemaValue>> {
  readonly initial: Static<TSchemaValue>;
  readonly name: string;
  readonly schema: TSchemaValue;
  readonly version: number;
}

export function defineState<TSchemaValue extends TSchema>(
  definition: {
    readonly initial: Static<TSchemaValue>;
    readonly name: string;
    readonly schema: TSchemaValue;
    readonly version: number;
  }
): StateDefinition<TSchemaValue> {
  return defineStateRuntime(definition) as StateDefinition<TSchemaValue>;
}

export function isStateDefinition(value: unknown): value is StateDefinition {
  return hasStateDefinitionBrand(value);
}
