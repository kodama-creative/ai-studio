import { defineInstructionsRuntime } from "../../internal/authored-instruction-definitions";

import type { RuntimeInstructionsDefinition } from "../../internal/authored-instruction-definitions";

export type InstructionsDefinition = Readonly<RuntimeInstructionsDefinition>;

export function defineInstructions<T extends InstructionsDefinition>(
  definition: T
): T {
  return defineInstructionsRuntime(definition);
}
