import { createContext, useContext } from "react";

import type {
  ExternalAgentProjectSubagentRun
} from "@/shared/external-agent-project";

const EMPTY_SUBAGENT_RUNS: readonly ExternalAgentProjectSubagentRun[] = [];

export const AgentSubagentRunsContext = createContext<
  readonly ExternalAgentProjectSubagentRun[]
>(EMPTY_SUBAGENT_RUNS);

export function useAgentSubagentRun(
  toolCallId: string
): ExternalAgentProjectSubagentRun | null {
  const runs = useContext(AgentSubagentRunsContext);
  return runs.find(run => run.parent.toolCallId === toolCallId) ?? null;
}

export function useAgentSubagentRunsForParentRun(
  runId: string | undefined
): readonly ExternalAgentProjectSubagentRun[] {
  const runs = useContext(AgentSubagentRunsContext);
  if (!runId) { return EMPTY_SUBAGENT_RUNS; }
  return runs.filter(run => run.parent.runId === runId);
}
