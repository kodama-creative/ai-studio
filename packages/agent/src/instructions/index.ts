import {
  defineDynamic,
  INSTRUCTIONS_BRAND,
  type ExactDefinition,
} from "../shared/types";

export interface InstructionsDefinition {
  readonly markdown: string;
}

export function defineInstructions<const T extends InstructionsDefinition>(
  definition: ExactDefinition<T, InstructionsDefinition>
): T {
  Object.defineProperty(definition, INSTRUCTIONS_BRAND, { value: true });
  return definition;
}

export { defineDynamic };
export type { DynamicResolveContext, DynamicSentinel } from "../shared/types";
