import { defineDynamicInstructionsRuntime } from "../../internal/authored-instruction-definitions";

import type { RuntimeDynamicInstructionsDefinition } from "../../internal/authored-instruction-definitions";

export type DynamicInstructionsDefinition = Readonly<
  RuntimeDynamicInstructionsDefinition
>;

export function defineDynamic(
  definition: Omit<DynamicInstructionsDefinition, "kind">
): DynamicInstructionsDefinition {
  return defineDynamicInstructionsRuntime(definition);
}
