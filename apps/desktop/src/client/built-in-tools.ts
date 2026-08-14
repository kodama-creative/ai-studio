import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  ProviderConnectionRef,
} from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { revealNativeFile } from "./native-files";
import { builtinToolsClient } from "./runtime-rpc-clients";

export async function listBuiltInTools(
  runtimeId?: RuntimeId
): Promise<BuiltinTool[]> {
  return builtinToolsClient.list(runtimeId);
}

export async function callBuiltInTool(
  input: {
    name: string;
    arguments: Record<string, unknown>;
    config?: Record<string, unknown>;
    connection?: ProviderConnectionRef;
  },
  runtimeId?: RuntimeId
): Promise<BuiltinToolCallResponse> {
  return builtinToolsClient.call(runtimeId, input);
}

/** Open a directory itself, or reveal a file selected in its parent folder. */
export async function fsReveal(path: string): Promise<void> {
  await revealNativeFile(path);
}
