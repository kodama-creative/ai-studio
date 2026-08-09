import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

import { resolveAgentProject } from "@llm-space/agent/loader";

export interface AgentProject {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly agentRoot: string;
  readonly threadRoot: string;
  readonly harnessStateRoot: string;
}

export async function openAgentProject(startPath: string): Promise<AgentProject> {
  const resolved = await resolveAgentProject({ startPath });
  const [rootPath, agentRoot] = await Promise.all([
    realpath(resolved.appRoot),
    realpath(resolved.agentRoot),
  ]);
  const threadRoot = join(rootPath, "threads");
  const harnessStateRoot = join(rootPath, ".llm-space", "harness");
  await Promise.all([
    mkdir(threadRoot, { recursive: true }),
    mkdir(harnessStateRoot, { recursive: true, mode: 0o700 }),
  ]);
  return {
    id: createHash("sha256").update(rootPath).digest("hex").slice(0, 16),
    name: basename(rootPath),
    rootPath,
    agentRoot,
    threadRoot,
    harnessStateRoot,
  };
}
