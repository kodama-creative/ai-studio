import { createHash } from "node:crypto";

import type { CompiledAgentDefinition } from "@llm-space/runtime";

export function agentDefinitionFingerprint(
  definition: CompiledAgentDefinition
): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}
