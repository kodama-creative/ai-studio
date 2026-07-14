import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";

/**
 * On a fresh install `LLM_SPACE_HOME/workspace` does not exist yet. Create the
 * directory and seed one runnable Agent Project. No-op once the workspace
 * directory exists, preserving every existing user's workspace.
 */
export function seedWorkspace(): void {
  const workspace = path.join(getLlmSpaceHomePath(), "workspace");
  if (existsSync(workspace)) {
    return;
  }
  mkdirSync(workspace, { recursive: true });
  const agentRoot = path.join(workspace, "example-agent", "agent");
  mkdirSync(path.join(agentRoot, "tools"), { recursive: true });
  mkdirSync(path.join(agentRoot, "skills", "weather-brief"), {
    recursive: true,
  });
  writeFileSync(
    path.join(agentRoot, "agent.ts"),
    `import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  reasoning: "high",
});
`
  );
  writeFileSync(
    path.join(agentRoot, "instructions.md"),
    "You are a concise weather assistant. Use get_weather before answering questions about a city. The data is intentionally mocked for this example.\n"
  );
  writeFileSync(
    path.join(agentRoot, "tools", "get-weather.ts"),
    `export default {
  name: "get_weather",
  label: "Get weather",
  description: "Return deterministic example weather for a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false
  },
  async execute(_toolCallId, { city }) {
    return {
      content: [{ type: "text", text: city + ": Sunny, 22°C" }],
      details: { city, mocked: true }
    };
  }
};
`
  );
  writeFileSync(
    path.join(agentRoot, "skills", "weather-brief", "SKILL.md"),
    "---\nname: weather-brief\ndescription: Produce a short practical weather brief.\n---\n\nUse the weather tool, state that the data is mocked, and keep the answer below four sentences.\n"
  );
}

// Run on import so the workspace is seeded before storage/RPC touch it.
seedWorkspace();
