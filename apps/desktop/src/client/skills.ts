import { createRpcClient } from "@/shared/namespaced-rpc";
import { SKILLS_RPC, type SkillsRequests } from "@/shared/skills-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";
import { pickNativeDirectory } from "./native-files";

export type SkillsClient = SkillsRequests;

/** Create one typed Skills namespace proxy for its owning renderer module. */
export function createSkillsClient(): SkillsClient {
  return createRpcClient(SKILLS_RPC, createElectrobunRpcClientTransport());
}

/** Open the native folder picker; resolves to the chosen path or `null`. */
export async function browseForSkillsPath(): Promise<string | null> {
  return pickNativeDirectory();
}
