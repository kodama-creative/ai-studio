import { describe, expect, mock, test } from "bun:test";

import type { ModelConfig } from "@llm-space/core";
import { renderToStaticMarkup } from "react-dom/server";

import {
  HostServicesProvider,
  type AuxiliaryGenerateInput,
  type AuxiliaryGenerationHost,
  type HostServices,
  type McpHost,
  type SkillsHost,
} from "../../host";
import type { GeneratorHost } from "../../host/types";

import { bindProjectGenerationRuntime } from "./codegen/project-generation-runtime";

const MODEL_PROVIDER_PATH = new URL("../model-provider.tsx", import.meta.url)
  .pathname;
await mock.module(MODEL_PROVIDER_PATH, () => ({
  useDefaultTextGenerationModel: () => null,
}));

const { useStreamText } = await import("./use-stream-text");

interface CapturedTextGeneration {
  abort(): void;
  run(): Promise<void>;
}

function _model(provider: string): ModelConfig {
  return { provider, id: `${provider}-model` };
}

function _host(auxiliaryGeneration: AuxiliaryGenerationHost): HostServices {
  return { auxiliaryGeneration } as HostServices;
}

function _captureTextGeneration(
  workflow: "prompt" | "function-tool",
  auxiliaryGeneration: AuxiliaryGenerationHost
): CapturedTextGeneration {
  let captured: CapturedTextGeneration | null = null;

  function Harness() {
    captured = useStreamText({
      systemPrompt:
        workflow === "prompt"
          ? "Generate a system prompt"
          : "Generate a function tool",
      model: _model(workflow),
    });
    return null;
  }

  renderToStaticMarkup(
    <HostServicesProvider value={_host(auxiliaryGeneration)}>
      <Harness />
    </HostServicesProvider>
  );

  if (!captured) throw new Error(`${workflow} generation hook was not rendered`);
  return captured;
}

describe("stateless auxiliary generation", () => {
  test.each(["prompt", "function-tool"] as const)(
    "%s generation uses the dedicated host capability and can be aborted",
    async (workflow) => {
      const attempts: AuxiliaryGenerateInput[] = [];
      const auxiliaryGeneration: AuxiliaryGenerationHost = {
        async *generate(input) {
          attempts.push(input);
          await new Promise<void>((resolve) => {
            if (input.signal?.aborted) resolve();
            else input.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          throw new DOMException("The operation was aborted", "AbortError");
        },
      };
      const generation = _captureTextGeneration(workflow, auxiliaryGeneration);

      const run = generation.run();
      await Promise.resolve();
      expect(attempts[0]).toMatchObject({
        systemPrompt:
          workflow === "prompt"
            ? "Generate a system prompt"
            : "Generate a function tool",
        model: { provider: workflow, id: `${workflow}-model` },
      });

      generation.abort();
      await run;
      expect(attempts[0]?.signal?.aborted).toBe(true);
    }
  );

  test("project generation uses auxiliary text generation and local host settings", async () => {
    const attempts: AuxiliaryGenerateInput[] = [];
    const calls: string[] = [];
    const auxiliaryGeneration: AuxiliaryGenerationHost = {
      async *generate(input) {
        attempts.push(input);
        yield { type: "text.completed", text: "Generated project plan" };
      },
    };
    const skills: SkillsHost = {
      getSettings: async () => ({ discoveryPaths: [] }),
      listAvailable: async () => {
        calls.push("skills.available");
        return [];
      },
      listSkills: async () => [],
    };
    const mcp = {
      listServers: async () => {
        calls.push("mcp.list");
        return [];
      },
    } as McpHost;
    const generator = {
      getSearchSettings: async () => {
        calls.push("search.settings");
        return {
          provider: "firecrawl" as const,
          braveApiKey: "",
          firecrawlApiKey: "",
          tavilyApiKey: "",
        };
      },
      resolveEnv: async () => {
        calls.push("generator.env");
        return { modelApiKey: "local-secret", envValues: {} };
      },
    } as GeneratorHost;
    const runtime = bindProjectGenerationRuntime({
      auxiliaryGeneration,
      profileId: "work",
      skills,
      mcp,
      generator,
    });
    if (!runtime) throw new Error("Project generation runtime was unavailable");

    expect(
      await runtime.runOneShot({
        systemPrompt: "Write a project plan",
        userPrompt: "Generate the project",
        model: _model("project"),
      })
    ).toBe("Generated project plan");
    await runtime.listEnabledSkills();
    await runtime.listMcpServers();
    await runtime.getSearchSettings();
    await runtime.resolveEnv("project", ["SEARCH_KEY"]);

    expect(attempts[0]).toMatchObject({
      systemPrompt: "Write a project plan",
      model: { provider: "project", id: "project-model" },
      profileId: "work",
    });
    expect(calls).toEqual([
      "skills.available",
      "mcp.list",
      "search.settings",
      "generator.env",
    ]);
  });
});
