import { expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import { reconcileExternalProjectThreadModel } from "./external-project-thread-model";

test("keeps an explicit model override across repeated Thread change events", () => {
  const original = _thread("openai", "gpt-5.3-codex", "agent");
  const edited = _thread("openai-codex", "gpt-5.4", "agent");
  const first = reconcileExternalProjectThreadModel({
    current: original,
    next: edited,
    projectId: "project-one",
    snapshot: "snapshot-one",
    definitionFingerprint: "definition-one",
    modelMatchesDefinition: false
  });

  const repeated = reconcileExternalProjectThreadModel({
    current: first,
    next: edited,
    projectId: "project-one",
    snapshot: "snapshot-one",
    definitionFingerprint: "definition-one",
    modelMatchesDefinition: false
  });

  expect(first.agentRuntime?.modelSource).toBe("threadOverride");
  expect(repeated.agentRuntime?.modelSource).toBe("threadOverride");
});

test("marks model parameter-only edits as an explicit Thread override", () => {
  const original = _thread("openai", "gpt-5.3-codex", "agent");
  const edited = {
    ...original,
    model: {
      ...original.model!,
      params: {
        ...original.model?.params,
        maxTokens: 2048,
        temperature: 0.4
      }
    }
  };

  const next = reconcileExternalProjectThreadModel({
    current: original,
    next: edited,
    projectId: "project-one",
    snapshot: "snapshot-one",
    definitionFingerprint: "definition-one",
    modelMatchesDefinition: true
  });

  expect(next.agentRuntime?.modelSource).toBe("threadOverride");
});

function _thread(
  provider: string,
  id: string,
  modelSource: "agent" | "threadOverride"
): Thread {
  return {
    title: "Model provenance",
    model: { provider, id, params: { reasoning: "high" } },
    context: { messages: [] },
    agentRuntime: {
      projectId: "project-one",
      snapshot: "snapshot-one",
      definitionFingerprint: "definition-one",
      modelSource
    }
  };
}
