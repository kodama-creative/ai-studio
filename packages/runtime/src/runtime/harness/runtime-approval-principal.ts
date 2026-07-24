import { sha256 } from "./sha256";

import type { AgentPrincipal } from "../../shared/agent-session-context";

export async function fingerprintRuntimeApprovalPrincipal(
  principal: AgentPrincipal
): Promise<string> {
  return sha256(JSON.stringify({
    issuer: principal.issuer,
    principalId: principal.principalId,
    principalType: principal.principalType
  }));
}
