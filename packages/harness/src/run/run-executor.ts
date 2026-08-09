import type {
  Conversation,
  ConversationAssistantMessage,
  ConversationToolCall,
} from "../conversation";
import type { PreparedTool } from "../generation/generation";
import type { AgentSnapshot } from "../studio/agent-snapshot";

import type { RunOwner } from "./run";

export interface ExecutableAgent {
  readonly snapshot: AgentSnapshot;
  readonly tools: ReadonlyMap<string, PreparedTool>;
}

export interface RunExecutionInput {
  readonly runId: string;
  readonly owner: RunOwner;
  readonly agent: ExecutableAgent;
  readonly conversation: Conversation;
}

export type RunOutputEvent =
  | {
      readonly type: "message.delta";
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "message.completed";
      readonly message: ConversationAssistantMessage;
    }
  | {
      readonly type: "tool.started";
      readonly messageId: string;
      readonly toolCallId: string;
    }
  | {
      readonly type: "tool.completed";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly result: NonNullable<ConversationToolCall["result"]>;
    };

export interface RunExecutor {
  execute(
    input: RunExecutionInput,
    options: { readonly signal: AbortSignal }
  ): AsyncIterable<RunOutputEvent>;
}
