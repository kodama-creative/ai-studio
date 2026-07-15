import type { AgentHarnessResources, AgentTool } from "@earendil-works/pi-agent-core";

import type { McpClientConnectionDefinition } from "../../public/definitions/connections/mcp";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";
import type { AgentProjectDiagnostic } from "../../shared/agent-project";

export interface CompiledMcpConnection {
  readonly name: string;
  readonly logicalPath: string;
  readonly definition: McpClientConnectionDefinition;
}

export interface CompiledProjectTool extends AgentTool {
  readonly sourcePath?: string;
}

export interface AgentProjectSnapshot {
  readonly root: string;
  readonly definition?: CompiledAgentDefinition;
  readonly instructions: string;
  readonly tools: readonly CompiledProjectTool[];
  readonly connections: readonly CompiledMcpConnection[];
  readonly resources: Readonly<AgentHarnessResources>;
  readonly diagnostics: readonly AgentProjectDiagnostic[];
  readonly fingerprint: string;
}
