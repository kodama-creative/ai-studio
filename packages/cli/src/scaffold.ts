import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENT_PROJECT_MANIFEST_FILE,
  AGENT_PROJECT_MANIFEST_VERSION
} from "@llm-space/runtime";

export type AgentProjectTemplate = "blank" | "starter";

export async function scaffoldAgentProject(options: {
  directory: string;
  template: AgentProjectTemplate;
}): Promise<string> {
  const root = path.resolve(options.directory);
  const manifestPath = path.join(root, AGENT_PROJECT_MANIFEST_FILE);
  const agentPath = path.join(root, "agent");
  await _assertMissing(manifestPath);
  await _assertMissing(agentPath);

  let createdRoot = false;
  try {
    await lstat(root);
  } catch (error) {
    if (!_hasCode(error, "ENOENT")) {
      throw error;
    }
    await mkdir(root, { recursive: true });
    createdRoot = true;
  }

  const stage = path.join(root, `.llm-space-init-${randomUUID()}`);
  let movedAgent = false;
  let movedManifest = false;
  try {
    await _writeStage(stage, options.template);
    await rename(path.join(stage, "agent"), agentPath);
    movedAgent = true;
    await rename(path.join(stage, AGENT_PROJECT_MANIFEST_FILE), manifestPath);
    movedManifest = true;
    await rm(stage, { recursive: true, force: true });
    return root;
  } catch (error) {
    if (movedManifest) {
      await rm(manifestPath, { force: true });
    }
    if (movedAgent) {
      await rm(agentPath, { recursive: true, force: true });
    }
    await rm(stage, { recursive: true, force: true });
    if (createdRoot) {
      await rm(root, { recursive: true, force: true });
    }
    throw error;
  }
}

async function _writeStage(
  stage: string,
  template: AgentProjectTemplate
): Promise<void> {
  const agent = path.join(stage, "agent");
  await mkdir(path.join(agent, "tools"), { recursive: true });
  await mkdir(path.join(agent, "skills"), { recursive: true });
  await writeFile(
    path.join(stage, AGENT_PROJECT_MANIFEST_FILE),
    `${JSON.stringify(
      { schemaVersion: AGENT_PROJECT_MANIFEST_VERSION, agent: "./agent" },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(agent, "agent.ts"),
    `import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  reasoning: "high",
  environment: {
    OPENAI_API_KEY: { kind: "secret", required: true },
  },
});
`,
    "utf8"
  );
  if (template === "blank") {
    await writeFile(
      path.join(agent, "instructions.md"),
      "You are a helpful assistant.\n",
      "utf8"
    );
    return;
  }
  await writeFile(
    path.join(agent, "instructions.md"),
    "You are a concise weather assistant. Use get-weather before answering questions about a city. The data is intentionally mocked for this starter project.\n",
    "utf8"
  );
  await writeFile(
    path.join(agent, "tools", "get-weather.ts"),
    `import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";

export default defineTool({
  description: "Return deterministic example weather for a city.",
  inputSchema: Type.Object({ city: Type.String() }),
  execute({ city }) {
    return { city, mocked: true, weather: city + ": Sunny, 22°C" };
  },
});
`,
    "utf8"
  );
  const skillRoot = path.join(agent, "skills", "weather-brief");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    "---\nname: weather-brief\ndescription: Produce a short practical weather brief.\n---\n\nUse the weather tool, state that the data is mocked, and keep the answer below four sentences.\n",
    "utf8"
  );
}

async function _assertMissing(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(`Refusing to overwrite existing path: ${target}`);
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
