import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  ProviderConnectionRef,
} from "@llm-space/core";

import { BUILTIN_TOOLS_RPC } from "@/shared/builtin-tools-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";
import { revealNativeFile } from "./native-files";

const builtinToolsClient = createRpcClient(
  BUILTIN_TOOLS_RPC,
  createElectrobunRpcClientTransport()
);

export async function listBuiltInTools(): Promise<BuiltinTool[]> {
  return builtinToolsClient.list();
}

export async function callBuiltInTool(
  input: {
    name: string;
    arguments: Record<string, unknown>;
    config?: Record<string, unknown>;
    connection?: ProviderConnectionRef;
  }
): Promise<BuiltinToolCallResponse> {
  return builtinToolsClient.call(input);
}

/** Open a directory itself, or reveal a file selected in its parent folder. */
export async function fsReveal(path: string): Promise<void> {
  await revealNativeFile(path);
}
