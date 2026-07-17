import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

import type { AgentProjectArtifact } from "./agent-project-artifact";
import type { RuntimeDynamicInstructionsDefinition } from "../../internal/authored-instruction-definitions";
import type { McpClientConnectionDefinition } from "../../public/definitions/connections/mcp";
import type { JsonValue } from "../../public/definitions/tool";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";
import type { AgentProjectDiagnostic } from "../../shared/agent-project";

export interface CompiledMcpConnection {
  readonly name: string;
  readonly logicalPath: string;
  readonly definition: McpClientConnectionDefinition;
}

export interface CompiledProjectTool extends AgentTool {
  readonly outputSchema?: AgentTool["parameters"];
  readonly sourcePath?: string;
}

export interface CompiledAgentStateDefinition {
  readonly initial: JsonValue;
  readonly name: string;
  readonly schema: TSchema;
  readonly schemaFingerprint: string;
  readonly sourcePath: string;
  readonly version: number;
}

export type CompiledAgentInstructionEntry =
  | {
    readonly definition: RuntimeDynamicInstructionsDefinition;
    readonly kind: "dynamic";
    readonly sourcePath: string;
  }
  | {
    readonly kind: "static";
    readonly markdown: string;
    readonly sourcePath: string;
  };

export interface CompiledAgentSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly filePath: string;
  readonly disableModelInvocation?: boolean;
}

export interface AgentProjectResources {
  readonly skills?: readonly CompiledAgentSkill[];
}

export interface AgentProjectSnapshot {
  readonly artifact?: AgentProjectArtifact;
  readonly root: string;
  readonly definition?: CompiledAgentDefinition;
  readonly instructions: string;
  readonly instructionEntries?: readonly CompiledAgentInstructionEntry[];
  readonly tools: readonly CompiledProjectTool[];
  readonly connections: readonly CompiledMcpConnection[];
  readonly resources: Readonly<AgentProjectResources>;
  readonly stateDefinitions?: readonly CompiledAgentStateDefinition[];
  readonly diagnostics: readonly AgentProjectDiagnostic[];
  readonly fingerprint: string;
}

export interface CompiledAgentProjectSnapshot extends AgentProjectSnapshot {
  readonly artifact: AgentProjectArtifact;
}
