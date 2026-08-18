import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SkillContent } from "@llm-space/core";
import type { ArkImageGenerationResult } from "@llm-space/runtime/models";

import { BuiltInTools } from "./built-in-tools";

const TEMP_DIRS: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRS.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

interface BuiltInToolsFixture {
  readonly workspaceRoot?: string;
  readonly findSkill?: (name: string) => SkillContent | null;
  readonly generateImage?: (
    input: Record<string, unknown>
  ) => Promise<ArkImageGenerationResult>;
}

function createBuiltInTools(fixture: BuiltInToolsFixture = {}): BuiltInTools {
  return new BuiltInTools(
    { findSkill: fixture.findSkill ?? (() => null) } as never,
    {
      get: () => ({
        provider: "brave",
        braveApiKey: "",
        firecrawlApiKey: "",
        tavilyApiKey: "",
      }),
    } as never,
    {
      generate:
        fixture.generateImage ??
        (() => Promise.reject(new Error("unused"))),
    } as never,
    {
      openWithDefaultApplication: () => undefined,
      revealInFileManager: () => Promise.resolve(),
    } as never,
    fixture.workspaceRoot ?? "/tmp/llm-space-workspace",
    {}
  );
}

describe("BuiltInTools", () => {
  test("snapshots one immutable definition for every fixed tool name", () => {
    const tools = createBuiltInTools().listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      "web_fetch",
      "web_search",
      "weather_report",
      "read",
      "write",
      "skill",
      "edit",
      "ls",
      "tree",
      "grep",
      "glob",
      "bash",
      "present_files",
      "generate_image",
      "todo_write",
      "sleep",
      "ask_user_question",
    ]);
    expect(Object.isFrozen(tools[0])).toBe(true);
    expect(Object.isFrozen(tools[0]?.parameters)).toBe(true);
  });

  test("runs bash from the injected Desktop workspace root", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bash-tool-"));
    TEMP_DIRS.push(directory);
    const expectedDirectory = await realpath(directory);

    const result = await createBuiltInTools({
      workspaceRoot: directory,
    }).call({
      name: "bash",
      arguments: { description: "Print working directory", command: "pwd" },
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          { stdout: `${expectedDirectory}\n`, stderr: "", exitCode: 0 },
          null,
          2
        ),
      },
    ]);
  });

  test("injects Skill and image-generation services into the fixed bundle", async () => {
    let generatedInput: unknown;
    const tools = createBuiltInTools({
      findSkill: (name) =>
        name === "fixture"
          ? {
              frontmatters: {},
              content: "Fixture instructions.",
              path: "/tmp/skills/fixture",
            }
          : null,
      generateImage: (input) => {
        generatedInput = input;
        return Promise.resolve({
          data: "aW1hZ2U=",
          mimeType: "image/png",
          model: "seedream-fixture",
          size: "2048x2048",
        });
      },
    });

    expect(
      await tools.call({ name: "skill", arguments: { name: "fixture" } })
    ).toEqual({
      content: [
        {
          type: "text",
          text: "Base directory for this skill: /tmp/skills/fixture\n\nFixture instructions.",
        },
      ],
    });
    expect(
      await tools.call({
        name: "generate_image",
        arguments: { prompt: "A red circle" },
        config: {
          model: "seedream-fixture",
          size: "2K",
          watermark: true,
        },
        connection: { providerId: "ark", profileId: "profile-work" },
      })
    ).toEqual({
      content: [
        {
          type: "text",
          text: "Generated image with seedream-fixture at 2048x2048.",
        },
        { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
      ],
    });
    expect(generatedInput).toEqual({
      prompt: "A red circle",
      model: "seedream-fixture",
      size: "2K",
      watermark: true,
      connection: { providerId: "ark", profileId: "profile-work" },
    });
  });

  test("returns supported image reads as structured model content", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "read-tool-"));
    TEMP_DIRS.push(directory);
    const imagePath = path.join(directory, "pixel.png");
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==";
    await writeFile(imagePath, Buffer.from(base64, "base64"));

    expect(
      await createBuiltInTools().call({
        name: "read",
        arguments: { path: imagePath },
      })
    ).toEqual({
      content: [
        { type: "text", text: `[image file: ${imagePath} (70 bytes)]` },
        { type: "image", data: base64, mimeType: "image/png" },
      ],
    });
  });

  test("rejects model-facing image reads above the transport limit", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "read-tool-"));
    TEMP_DIRS.push(directory);
    const imagePath = path.join(directory, "oversized.png");
    await writeFile(imagePath, "");
    await truncate(imagePath, 20 * 1024 * 1024 + 1);

    expect(
      createBuiltInTools().call({
        name: "read",
        arguments: { path: imagePath },
      })
    ).rejects.toThrow("maximum 20971520 bytes / 20 MiB");
  });

  test("normalizes calls and validates tool and provider identity", async () => {
    const tools = createBuiltInTools();

    expect(
      await tools.call({ name: "todo_write", arguments: { todos: [] } })
    ).toEqual({ content: [{ type: "text", text: "OK" }] });
    expect(
      tools.call({ name: "missing", arguments: {} })
    ).rejects.toThrow("Built-in tool not found: missing");
    expect(
      tools.call({
        name: "generate_image",
        arguments: {},
        connection: { providerId: "openai" },
      })
    ).rejects.toThrow(
      "Built-in tool generate_image does not use provider: openai"
    );
  });
});
