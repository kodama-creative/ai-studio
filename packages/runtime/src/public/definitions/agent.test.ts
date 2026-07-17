import { describe, expect, test } from "bun:test";

import { defineAgent } from "./agent";

describe("defineAgent", () => {
  test("preserves authored literal definition values", () => {
    const definition = defineAgent({
      model: "openai/gpt-5.3-codex",
      reasoning: "high",
      environment: {
        LOG_LEVEL: {
          kind: "config",
          required: false,
          description: "Optional runtime logging level"
        },
        OPENAI_API_KEY: {
          kind: "secret",
          required: true
        }
      }
    });

    expect(definition).toEqual({
      model: "openai/gpt-5.3-codex",
      reasoning: "high",
      environment: {
        LOG_LEVEL: {
          kind: "config",
          required: false,
          description: "Optional runtime logging level"
        },
        OPENAI_API_KEY: {
          kind: "secret",
          required: true
        }
      }
    });
    expect(definition.model).toBe("openai/gpt-5.3-codex");
  });

  test("rejects unsupported authored fields and reasoning at typecheck", () => {
    const typecheck = () => {
      // @ts-expect-error authored definitions use `none`, not Pi's `off`
      defineAgent({ model: "openai/model", reasoning: "off" });
      // @ts-expect-error unsupported definition fields are rejected
      defineAgent({ model: "openai/model", name: "Agent" });
      defineAgent({
        model: "openai/model",
        environment: {
          // @ts-expect-error environment kind is closed
          API_KEY: { kind: "credential", required: true }
        }
      });
      defineAgent({
        model: "openai/model",
        environment: {
          // @ts-expect-error environment requirements never carry values
          API_KEY: { kind: "secret", required: true, default: "secret" }
        }
      });
    };
    expect(typecheck).toBeFunction();
  });
});
