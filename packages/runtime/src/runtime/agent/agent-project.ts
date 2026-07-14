import type {
  AgentHarnessResources,
  AgentTool,
  Skill,
} from "@earendil-works/pi-agent-core";

import type { CompiledAgentDefinition } from "../../shared/agent-definition";
import type { AgentProjectDiagnostic } from "../../shared/agent-project";

export interface AgentProjectSnapshot {
  readonly root: string;
  readonly definition?: CompiledAgentDefinition;
  readonly instructions: string;
  readonly tools: readonly AgentTool[];
  readonly resources: Readonly<AgentHarnessResources<Skill>>;
  readonly diagnostics: readonly AgentProjectDiagnostic[];
  readonly fingerprint: string;
}
