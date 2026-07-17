import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  AGENT_PROJECT_MANIFEST_FILE,
  AGENT_PROJECT_MANIFEST_VERSION
} from "../../shared/agent-project-manifest";
import {
  AGENT_PROJECT_PRESETS,
  type AgentProjectMcpConnectionPreset,
  type AgentProjectPreset,
  type AgentProjectScaffoldConfig,
  isAgentProjectMcpToolName,
  isAgentProjectMcpUrl,
  isAgentProjectName,
  isAgentProjectPreset
} from "../../shared/agent-project-scaffold";
import { loadAgentProject } from "../compiler/load-agent-project";
import { loadAgentProjectManifest } from "../discover/manifest";

export interface ScaffoldAgentProjectOptions
  extends AgentProjectScaffoldConfig {
  readonly directory: string;
}

export interface ScaffoldedAgentProject {
  readonly directory: string;
  readonly presets: readonly AgentProjectPreset[];
}

export async function scaffoldAgentProject(
  options: ScaffoldAgentProjectOptions
): Promise<ScaffoldedAgentProject> {
  const config = _normalizeConfig(options);
  const requestedDirectory = path.resolve(options.directory);
  const name = path.basename(requestedDirectory);
  if (!isAgentProjectName(name)) {
    throw new Error(
      "Agent Project name must use lowercase kebab-case letters and numbers."
    );
  }
  const parent = await _canonicalParent(path.dirname(requestedDirectory));
  const directory = path.join(parent, name);
  await _assertMissing(directory);
  const stage = path.join(parent, `.llm-space-scaffold-${randomUUID()}`);
  let reservedTarget = false;
  try {
    await mkdir(stage, { mode: 0o700 });
    await _writeProject(stage, config);
    await _validateProject(stage);
    // `rename()` replaces an existing empty directory on POSIX. Reserve the
    // absent target atomically first so a concurrent creator cannot be
    // overwritten by the whole-root publication rename.
    await mkdir(directory, { mode: 0o700 });
    reservedTarget = true;
    await rename(stage, directory);
    reservedTarget = false;
    return Object.freeze({
      directory,
      presets: Object.freeze([...config.presets])
    });
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (reservedTarget) {
      // Remove only our still-empty reservation. Never recursively remove a
      // target another process populated while publication was in flight.
      await rmdir(directory).catch(() => undefined);
    }
    throw error;
  }
}

function _normalizeConfig(
  options: ScaffoldAgentProjectOptions
): AgentProjectScaffoldConfig {
  const seen = new Set<string>();
  for (const preset of options.presets) {
    if (!isAgentProjectPreset(preset)) {
      throw new Error(`Unsupported Agent Project preset: ${String(preset)}`);
    }
    if (seen.has(preset)) {
      throw new Error(`Duplicate Agent Project preset: ${preset}`);
    }
    seen.add(preset);
  }
  const presets = AGENT_PROJECT_PRESETS.filter(preset => seen.has(preset));
  const hasMcp = seen.has("mcp-connection");
  if (hasMcp !== Boolean(options.mcpConnection)) {
    throw new Error(
      hasMcp
        ? "The mcp-connection preset requires MCP connection settings."
        : "MCP connection settings require the mcp-connection preset."
    );
  }
  return Object.freeze({
    presets: Object.freeze(presets),
    ...(options.mcpConnection
      ? { mcpConnection: _normalizeMcp(options.mcpConnection) }
      : {})
  });
}

function _normalizeMcp(
  input: AgentProjectMcpConnectionPreset
): AgentProjectMcpConnectionPreset {
  const inputUrl = input.url.trim();
  if (!isAgentProjectMcpUrl(inputUrl)) {
    throw new Error(
      "MCP URL must use HTTP(S) and cannot contain credentials."
    );
  }
  const url = new URL(inputUrl);
  const tools = input.tools.map(tool => tool.trim());
  if (
    tools.length === 0
    || tools.some(tool => !isAgentProjectMcpToolName(tool))
  ) {
    throw new Error(
      "MCP tools must contain at least one valid exact remote tool name."
    );
  }
  if (new Set(tools).size !== tools.length) {
    throw new Error("MCP tools cannot contain duplicate names.");
  }
  return Object.freeze({
    url: url.toString(),
    tools: Object.freeze(tools)
  });
}

async function _canonicalParent(parent: string): Promise<string> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(parent);
  } catch (error) {
    throw new Error(`Agent Project parent directory does not exist: ${parent}`, {
      cause: error
    });
  }
  if (!info.isDirectory()) {
    throw new Error(`Agent Project parent is not a directory: ${parent}`);
  }
  return realpath(parent);
}

async function _assertMissing(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if (_hasCode(error, "ENOENT")) { return; }
    throw error;
  }
  throw new Error(`Refusing to overwrite existing path: ${target}`);
}

async function _writeProject(
  root: string,
  config: AgentProjectScaffoldConfig
): Promise<void> {
  const agent = path.join(root, "agent");
  await mkdir(agent);
  await Promise.all([
    writeFile(
      path.join(root, AGENT_PROJECT_MANIFEST_FILE),
      `${JSON.stringify({
        schemaVersion: AGENT_PROJECT_MANIFEST_VERSION,
        agent: "./agent"
      }, null, 2)}\n`,
      "utf8"
    ),
    writeFile(path.join(agent, "agent.ts"), _agentDefinition(), "utf8"),
    writeFile(
      path.join(agent, "instructions.md"),
      _instructions(config.presets),
      "utf8"
    )
  ]);
  if (config.presets.includes("local-tool")) {
    const tools = path.join(agent, "tools");
    await mkdir(tools);
    await writeFile(path.join(tools, "echo.ts"), _echoTool(), "utf8");
  }
  if (config.presets.includes("skill")) {
    const skill = path.join(agent, "skills", "concise-response");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), _conciseSkill(), "utf8");
  }
  if (config.mcpConnection) {
    const connections = path.join(agent, "connections");
    await mkdir(connections);
    await writeFile(
      path.join(connections, "remote.ts"),
      _mcpConnection(config.mcpConnection),
      "utf8"
    );
  }
}

async function _validateProject(root: string): Promise<void> {
  const manifest = await loadAgentProjectManifest(root);
  const snapshot = await loadAgentProject(manifest.agentRoot);
  const errors = snapshot.diagnostics.filter(item => item.severity === "error");
  if (!snapshot.definition || errors.length > 0) {
    throw new Error(
      errors[0]?.message ?? "Generated Agent Project has no valid definition."
    );
  }
}

function _agentDefinition(): string {
  return `import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  reasoning: "high",
  environment: {
    OPENAI_API_KEY: { kind: "secret", required: true }
  }
});
`;
}

function _instructions(presets: readonly AgentProjectPreset[]): string {
  const sections = ["You are a helpful assistant."];
  if (presets.includes("local-tool")) {
    sections.push("Use the echo tool before answering requests to repeat text.");
  }
  if (presets.includes("skill")) {
    sections.push(
      "A concise-response skill is available when the user wants a brief answer."
    );
  }
  if (presets.includes("mcp-connection")) {
    sections.push("Use configured remote tools only when they are relevant.");
  }
  return `${sections.join("\n\n")}\n`;
}

function _echoTool(): string {
  return `import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";

export default defineTool({
  description: "Return the provided text unchanged.",
  inputSchema: Type.Object({ text: Type.String() }),
  execute({ text }) {
    return { text };
  }
});
`;
}

function _conciseSkill(): string {
  return `---
name: concise-response
description: Produce a brief, direct answer.
---

Answer directly, keep the response below four sentences, and omit repetition.
`;
}

function _mcpConnection(input: AgentProjectMcpConnectionPreset): string {
  return `import { defineMcpClientConnection } from "@llm-space/runtime/connections";

export default defineMcpClientConnection({
  url: ${JSON.stringify(input.url)},
  description: "Remote tools selected when this Agent Project was created.",
  tools: { allow: ${JSON.stringify(input.tools)} }
});
`;
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
