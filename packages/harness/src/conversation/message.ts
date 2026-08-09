import type { AgentModelDefinition } from "@llm-space/agent";
import type { ToolModelOutput } from "@llm-space/agent/tools";

export interface TextMessageContent {
  readonly type: "text";
  readonly text: string;
}

export interface ImageMessageContent {
  readonly type: "image";
  readonly mimeType: string;
  readonly data: string;
}

export type MessageContent = TextMessageContent | ImageMessageContent;

export interface MessageOrigin {
  readonly runId: string;
}

export interface ConversationToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly result?: {
    readonly output: ToolModelOutput;
    readonly isError: boolean;
  };
}

export interface ConversationUserMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: readonly MessageContent[];
  readonly origin?: MessageOrigin;
}

export interface ConversationAssistantMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly content: readonly MessageContent[];
  readonly thinking?: string;
  readonly toolCalls?: readonly ConversationToolCall[];
  readonly model?: AgentModelDefinition;
  readonly origin?: MessageOrigin;
}

export type ConversationMessage =
  ConversationUserMessage | ConversationAssistantMessage;
