import { createRpcClient } from "@/shared/namespaced-rpc";
import { PROMPT_FILES_RPC } from "@/shared/prompt-files-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed Prompt Files proxy for its owning renderer module. */
export function createPromptFilesClient() {
  return createRpcClient(
    PROMPT_FILES_RPC,
    createElectrobunRpcClientTransport()
  );
}
