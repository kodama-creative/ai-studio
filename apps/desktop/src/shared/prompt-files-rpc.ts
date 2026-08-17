import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export const PROMPT_FILES_SERVICE = Symbol("PromptFilesService");

export interface PromptFilesRequests {
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export type PromptFilesRpc = RequestRpcShape<PromptFilesRequests>;

export const PROMPT_FILES_RPC = defineRpcNamespace<PromptFilesRpc>(
  "promptFiles",
  {
    requests: { readText: true, exists: true },
    streams: {},
    events: {},
  }
);
