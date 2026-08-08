import { expect, test } from "bun:test";

import { defineHook } from "./hooks";
import { defineInstrumentation } from "./instrumentation";
import { defineSchedule } from "./schedules";
import { defineSkill } from "./skills";
import { defineTool } from "./tools";

import { defineAgent, defineDynamic, defineRemoteAgent } from "./index";

function _assertAuthoringTypes(): void {
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "fixture",
      types: undefined as unknown as {
        input: { query: string };
        output: { query: string };
      },
      jsonSchema: {
        input: () => ({ type: "object" }),
        output: () => ({ type: "object" }),
      },
    },
  };
  defineTool({
    description: "Search",
    inputSchema: schema,
    execute(input) {
      const query: string = input.query;
      return query.toUpperCase();
    },
  });
  defineRemoteAgent({
    description: "Remote",
    url: () => Promise.resolve("https://example.test"),
  });
  defineAgent({
    model: defineDynamic({
      fallback: "openai/gpt-5",
      events: { "turn.started": () => "anthropic/claude-sonnet-4.5" },
    }),
    compaction: {
      model: "openai/gpt-5-mini",
      modelContextWindowTokens: 128_000,
      thresholdPercent: 0.9,
    },
    experimental: {
      subagentPersistentSessions: true,
      workflow: { world: "@acme/workflow-world" },
    },
    limits: {
      sessionTimeoutMs: false,
      maxInputTokensPerSession: 1_000_000,
      maxOutputTokensPerSession: 100_000,
    },
  });
  const validationOnlySchema = {
    "~standard": {
      version: 1 as const,
      vendor: "fixture",
      types: undefined as unknown as {
        input: { value: number };
        output: { value: number };
      },
      validate: (value: unknown) => ({ value: value as { value: number } }),
    },
  };
  defineTool({
    description: "Validate",
    inputSchema: validationOnlySchema,
    execute(input) {
      const value: number = input.value;
      return value;
    },
  });
  defineSchedule({ cron: "0 * * * *", markdown: "Run" });
  defineSchedule({ cron: "0 * * * *", run: () => undefined });

  // @ts-expect-error identity comes from the agent path/package
  defineAgent({ name: "authored-name" });
  // @ts-expect-error model is required by the Eve-compatible agent contract
  defineAgent({ description: "Missing model" });
  // @ts-expect-error old step limits are not part of the Eve-compatible contract
  defineAgent({ model: "test/model", limits: { maxSteps: 10 } });
  // @ts-expect-error schedules require exactly one of markdown or run
  defineSchedule({ cron: "0 * * * *" });
  // @ts-expect-error schedules cannot define both markdown and run
  defineSchedule({ cron: "0 * * * *", markdown: "Run", run: () => undefined });
  // @ts-expect-error skill identity is path-derived
  defineSkill({ description: "Review", markdown: "Review", name: "review" });
  // @ts-expect-error hook definitions reject unknown top-level keys
  defineHook({ events: {}, priority: 1 });
  // @ts-expect-error instrumentation definitions reject unknown top-level keys
  defineInstrumentation({ enabled: true });
}

test("authoring type contracts compile", () => {
  expect(typeof _assertAuthoringTypes).toBe("function");
});
