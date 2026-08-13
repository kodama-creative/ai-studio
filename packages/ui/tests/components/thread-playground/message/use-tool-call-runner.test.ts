import { expect, test } from "bun:test";

import type { Tool } from "@llm-space/core";

import {
  canRunToolCall,
  findTool,
} from "../../../../src/components/thread-playground/message/use-tool-call-runner";

test("an Agent function tool is runnable through the external Engine runtime", () => {
  const tool: Tool = {
    type: "function",
    name: "word-count",
    description: "Count words",
    parameters: { type: "object" },
  };

  expect(canRunToolCall(findTool([tool], "word-count"), true)).toBeTrue();
  expect(canRunToolCall(findTool([tool], "word-count"), false)).toBeFalse();
  expect(canRunToolCall(undefined, true)).toBeFalse();
});

test("an external Engine runtime does not claim provider-hosted tools", () => {
  const tool: Tool = {
    type: "provider-hosted",
    config: { type: "web_search" },
  };

  expect(canRunToolCall(tool, true)).toBeFalse();
});
