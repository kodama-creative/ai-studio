import { describe, expect, test } from "bun:test";

import { defineAgent } from "../../../src/public/definitions/agent";

describe("defineAgent Session limits", () => {
  test("preserves authored token-budget values", () => {
    const definition = defineAgent({
      model: "openai/gpt-5.3-codex",
      limits: {
        maxInputTokensPerSession: 200_000,
        maxOutputTokensPerSession: false
      }
    });

    expect(definition.limits).toEqual({
      maxInputTokensPerSession: 200_000,
      maxOutputTokensPerSession: false
    });
  });

  test("keeps token-budget values type-safe", () => {
    const typecheck = () => defineAgent({
      model: "openai/model",
      limits: {
        // @ts-expect-error limits must be positive safe integers or false
        maxInputTokensPerSession: "1000"
      }
    });

    expect(typecheck).toBeFunction();
  });
});
