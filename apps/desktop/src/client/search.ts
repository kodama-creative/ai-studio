import type { SearchSettings } from "@llm-space/core";

import { createRpcClient } from "@/shared/namespaced-rpc";
import { SEARCH_RPC } from "@/shared/search-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const searchClient = createRpcClient(
  SEARCH_RPC,
  createElectrobunRpcClientTransport()
);

export async function getSearchSettings(): Promise<SearchSettings> {
  return searchClient.get();
}

export async function setSearchSettings(
  settings: SearchSettings
): Promise<SearchSettings> {
  return searchClient.set(settings);
}
