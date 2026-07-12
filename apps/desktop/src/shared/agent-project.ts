import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ModelConfig } from "@llm-space/core";
import type { AgentProjectDiagnostic } from "@llm-space/runtime";

export type AgentSessionKind = "builder" | "target";

export interface AgentProjectMessageView {
  role: AgentMessage["role"];
  text: string;
  toolCalls?: {
    id: string;
    name: string;
    arguments: unknown;
    result?: string;
    isError?: boolean;
  }[];
}

export interface AgentProjectSessionView {
  id: string;
  createdAt: string;
}

export interface AgentProjectConversationView {
  activeSessionId: string | null;
  sessions: AgentProjectSessionView[];
  messages: AgentProjectMessageView[];
  changedFiles: string[];
}

export interface AgentProjectView {
  path: string;
  name: string;
  model: ModelConfig | null;
  instructions: string;
  tools: { name: string; description: string }[];
  skills: { name: string; description: string }[];
  diagnostics: AgentProjectDiagnostic[];
  sourceFiles: string[];
  builder: AgentProjectConversationView;
  target: AgentProjectConversationView;
}

export interface StreamAgentProjectRequestPayload {
  streamId: string;
  projectPath: string;
  kind: AgentSessionKind;
  text: string;
}

export type StreamAgentProjectResponsePayload =
  | { streamId: string; type: "event"; event: AgentEvent }
  | { streamId: string; type: "done"; project: AgentProjectView }
  | { streamId: string; type: "error"; message: string };

export interface AbortAgentProjectStreamPayload {
  streamId: string;
}
