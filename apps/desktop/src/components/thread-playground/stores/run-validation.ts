import {
  isRunnableConversation,
  type Message
} from "@llm-space/core";

import type { RunValidationIssue } from "./run-validation-issue";

export function getRunValidationIssue(
  messages: Message[]
): RunValidationIssue | null {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return null;
  }
  if (!isRunnableConversation(messages)) {
    return {
      code: "lastAssistantMessage",
      level: "warning",
      message: "Please add a user message to run",
      messageId: lastMessage.id,
      resolution: {
        type: "appendUserMessage"
      }
    };
  }
  return null;
}
