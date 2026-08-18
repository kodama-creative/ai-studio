import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

import { resolveAgentProject } from "@llm-space/agent/loader";
import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { inject, injectable } from "inversify";

import { APP_HOME_PATH } from "../app/desktop-paths";

export interface AgentProject {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly agentRoot: string;
  readonly studioStateRoot: string;
  readonly databasePath: string;
}

export async function openAgentProject(
  startPath: string,
  options: { readonly homePath?: string } = {}
): Promise<AgentProject> {
  const resolved = await resolveAgentProject({ startPath });
  const [rootPath, agentRoot] = await Promise.all([
    realpath(resolved.appRoot),
    realpath(resolved.agentRoot),
  ]);
  const id = createHash("sha256").update(rootPath).digest("hex").slice(0, 16);
  // Studio state is application data, not project source. Keeping it under the
  // LLM Space home avoids dirtying or mutating a user's Agent Project.
  const studioStateRoot = join(
    options.homePath ?? getLlmSpaceHomePath(),
    "studio",
    "projects",
    id
  );
  await mkdir(studioStateRoot, { recursive: true, mode: 0o700 });
  return {
    id,
    name: basename(rootPath),
    rootPath,
    agentRoot,
    studioStateRoot,
    databasePath: join(studioStateRoot, "studio.sqlite"),
  };
}

/** Resolve user-selected source paths into immutable Desktop Project identity. */
@injectable()
export class AgentProjectLoader {
  constructor(@inject(APP_HOME_PATH) private readonly _homePath: string) {}

  /** Open one Agent Project without storing application data in its source tree. */
  open(startPath: string): Promise<AgentProject> {
    return openAgentProject(startPath, { homePath: this._homePath });
  }
}
