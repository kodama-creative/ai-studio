import type { ConversationMessage } from "./message";

export interface Conversation {
  readonly messages: readonly ConversationMessage[];
  readonly state: Readonly<Record<string, unknown>>;
}
