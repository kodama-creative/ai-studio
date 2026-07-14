import { expect, test } from "bun:test";

import { agentModelMatchesDefinition } from "./agent-model-matches-definition";

test("matches provider, model id, and effective reasoning as one definition", () => {
  const definition = {
    model: { provider: "openai", id: "gpt-5.3-codex" },
    reasoning: "high" as const,
  };

  expect(
    agentModelMatchesDefinition({
      model: { provider: "openai", id: "gpt-5.3-codex" },
      reasoning: "high",
      definition,
    })
  ).toBe(true);
  expect(
    agentModelMatchesDefinition({
      model: { provider: "openai", id: "gpt-5.3-codex" },
      reasoning: undefined,
      definition,
    })
  ).toBe(false);
});
