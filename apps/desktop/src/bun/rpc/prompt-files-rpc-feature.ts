import {
  readUserTextFile,
  userTextFileExists,
} from "@llm-space/core/server";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PROMPT_FILES_RPC,
  type PromptFilesRequests,
  type PromptFilesRpc,
} from "../../shared/prompt-files-rpc";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class PromptFilesRpcServer implements RpcServer<PromptFilesRpc> {
  readonly namespace = PROMPT_FILES_RPC;
  readonly streams = {};
  readonly requests: PromptFilesRequests = {
    readText: (path) => readUserTextFile(path),
    exists: (path) => userTextFileExists(path),
  };
}

/** Owns guarded prompt-file reads for one native window. */
export class PromptFilesRpcContribution implements RpcContribution {
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new PromptFilesRpcServer());
  }
}
