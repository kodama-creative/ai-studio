import type { Models } from "@earendil-works/pi-ai";

import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";

export function createHostCapabilityPolicy(input: {
  readonly extraTools?: readonly PreparedAgentTool[];
  readonly models: Models;
  readonly project: AgentProjectSnapshot;
}): AgentCapabilityPolicy {
  const extraTools = input.extraTools ?? [];
  return {
    connectionContributions: [
      ...input.project.connections.map(
        connection => `connection:${connection.logicalPath}`
      ),
      ...extraTools.flatMap(tool => (tool.provenance?.connectionName
        ? [tool.provenance.contributionId]
        : []))
    ],
    modelOptions: {
      cacheRetention: ["none", "short", "long"],
      maxRetryDelayMs: { min: 0, max: Number.MAX_SAFE_INTEGER },
      maxRetries: { min: 0, max: 100 },
      maxTokens: { min: 1, max: Number.MAX_SAFE_INTEGER },
      temperature: { min: 0, max: 2 },
      thinkingBudgets: { min: 0, max: Number.MAX_SAFE_INTEGER },
      timeoutMs: { min: 0, max: Number.MAX_SAFE_INTEGER },
      transport: ["auto", "sse", "websocket", "websocket-cached"],
      websocketConnectTimeoutMs: { min: 0, max: Number.MAX_SAFE_INTEGER }
    },
    models: input.models.getModels().map(model => ({
      provider: model.provider,
      id: model.id
    })),
    reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"],
    toolContributions: [
      ...input.project.tools.map(
        tool => `tool:${tool.sourcePath ?? tool.name}`
      ),
      ...(input.project.dynamicToolResolvers ?? []).map(
        resolver => resolver.contributionId
      ),
      ...extraTools.flatMap(tool => (tool.provenance?.connectionName
        ? []
        : [tool.provenance?.contributionId
          ?? `host-tool:${tool.definition.name}`]))
    ]
  };
}
