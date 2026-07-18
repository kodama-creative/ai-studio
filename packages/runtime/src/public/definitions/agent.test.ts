import { describe, expect, test } from "bun:test";

import { defineAgent } from "./agent";
import { defineDynamic } from "../models/define-dynamic";

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

  test("preserves an Eve-shaped dynamic model fallback and safe options", async () => {
    const dynamic = defineDynamic({
      fallback: "openai/gpt-5.3-codex",
      events: {
        "turn.started": (_event, { session }) => ({
          model: session.channel.kind === "test"
            ? "openai/gpt-5.3-codex"
            : "openai/gpt-5.3",
          modelOptions: { temperature: 0.4, maxRetries: 1 }
        })
      }
    });
    const definition = defineAgent({
      model: dynamic,
      modelOptions: { cacheRetention: "short", maxTokens: 4_096 }
    });

    expect(definition.model).toBe(dynamic);
    expect((await dynamic.events["turn.started"](
      { type: "turn.started" },
      {
        session: {
          id: "session",
          auth: {
            initiator: {
              issuer: "test",
              principalId: "one",
              principalType: "user"
            },
            current: {
              issuer: "test",
              principalId: "one",
              principalType: "user"
            }
          },
          channel: { kind: "test" },
          turn: { id: "turn", sequence: 1 }
        }
      }
    ))).toMatchObject({ modelOptions: { temperature: 0.4 } });
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
      defineAgent({
        model: "openai/model",
        environment: {
          API_KEY: { kind: "secret", required: true },
          // @ts-expect-error duplicate environment names are rejected
          API_KEY: { kind: "config", required: false }
        }
      });
    };
    expect(typecheck).toBeFunction();
  });
});
