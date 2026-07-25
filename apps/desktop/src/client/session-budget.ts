import type { StoredRuntimeSession } from "@llm-space/runtime/harness";

import { electrobun } from "@/lib/electrobun";

export async function decideSessionBudget(
  budgetWaitId: string,
  decision: "freshWindow" | "stop"
): Promise<StoredRuntimeSession> {
  const rpc = electrobun.rpc;
  if (!rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  return rpc.request.decideSessionBudget({
    budgetWaitId,
    decision
  });
}
