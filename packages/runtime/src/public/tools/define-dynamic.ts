import { defineDynamicToolsRuntime } from "../../internal/authored-dynamic-tools-definition";

import type { RuntimeDynamicToolsDefinition } from "../../internal/authored-dynamic-tools-definition";

export type DynamicToolsDefinition = Readonly<RuntimeDynamicToolsDefinition>;

export function defineDynamic(
  definition: Omit<DynamicToolsDefinition, "kind">
): DynamicToolsDefinition {
  return defineDynamicToolsRuntime(definition);
}
