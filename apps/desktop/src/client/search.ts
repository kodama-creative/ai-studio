import { createRpcClient } from "@/shared/namespaced-rpc";
import { SEARCH_RPC, type SearchRequests } from "@/shared/search-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export type SearchClient = SearchRequests;

/** Create one typed Search namespace proxy for its owning renderer module. */
export function createSearchClient(): SearchClient {
  return createRpcClient(SEARCH_RPC, createElectrobunRpcClientTransport());
}
