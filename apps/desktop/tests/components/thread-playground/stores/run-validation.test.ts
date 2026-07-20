import { expect, mock, test } from "bun:test";

import type { Message } from "@llm-space/core";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));

test("identifies the message that prevents Run", async () => {
  const { getRunValidationIssue } = await import(
    "@/components/thread-playground/stores"
  );
  const assistant: Message = {
    id: "assistant-one",
    role: "assistant",
    content: [{ type: "text", text: "Answer" }]
  };
  expect(getRunValidationIssue([assistant])).toEqual({
    code: "lastAssistantMessage",
    level: "warning",
    message: "Please add a user message to run",
    messageId: "assistant-one",
    resolution: {
      type: "appendUserMessage"
    }
  });
});

test("accepts an empty user message", async () => {
  const { getRunValidationIssue } = await import(
    "@/components/thread-playground/stores"
  );
  const emptyUser: Message = {
    id: "user-empty",
    role: "user",
    content: [{ type: "text", text: "" }]
  };

  expect(getRunValidationIssue([emptyUser])).toBeNull();
});
