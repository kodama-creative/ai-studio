import { createHash } from "node:crypto";

import type { ResolvedAgentDefinition } from "@llm-space/runtime";

export function agentDefinitionFingerprint(
  definition: ResolvedAgentDefinition
): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}
