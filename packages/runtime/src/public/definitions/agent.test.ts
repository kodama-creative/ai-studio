import { describe, expect, test } from "bun:test";

import { defineAgent } from "./agent";

describe("defineAgent", () => {
  test("preserves authored literal definition values", () => {
    const definition = defineAgent({
      model: "openai/gpt-5.3-codex",
      reasoning: "high",
    });

    expect(definition).toEqual({
      model: "openai/gpt-5.3-codex",
      reasoning: "high",
    });
    expect(definition.model).toBe("openai/gpt-5.3-codex");
  });

  test("rejects unsupported authored fields and reasoning at typecheck", () => {
    const typecheck = () => {
      // @ts-expect-error authored definitions use `none`, not Pi's `off`
      defineAgent({ model: "openai/model", reasoning: "off" });
      // @ts-expect-error unsupported definition fields are rejected
      defineAgent({ model: "openai/model", name: "Agent" });
    };
    expect(typecheck).toBeFunction();
  });
});
