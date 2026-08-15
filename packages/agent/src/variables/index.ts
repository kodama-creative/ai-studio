import {
  VARIABLE_BRAND,
  type ExactDefinition,
  type MaybePromise,
} from "../shared/types";
import type { SkillHandle } from "../skills";

export interface VariableResolveContext {
  readonly skills: readonly SkillHandle[];
}

/** One authored prompt variable resolved from the Agent's mounted Skills. */
export interface VariableDefinition {
  readonly name: string;
  resolve(context: VariableResolveContext): MaybePromise<string>;
}

export function defineVariable<const T extends VariableDefinition>(
  definition: ExactDefinition<T, VariableDefinition>
): T {
  Object.defineProperty(definition, VARIABLE_BRAND, { value: true });
  return definition;
}
