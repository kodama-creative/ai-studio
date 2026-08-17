import type { SearchSettings } from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export const SEARCH_SERVICE = Symbol("SearchService");

export interface SearchRequests {
  get(): Promise<SearchSettings>;
  set(settings: SearchSettings): Promise<SearchSettings>;
}

export type SearchRpc = RequestRpcShape<SearchRequests>;

export const SEARCH_RPC = defineRpcNamespace<SearchRpc>("search", {
  requests: { get: true, set: true },
  streams: {},
  events: {},
});
