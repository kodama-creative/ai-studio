import type { SearchSettingsManager } from "@llm-space/runtime/search";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  SEARCH_RPC,
  type SearchRequests,
  type SearchRpc,
} from "../../shared/search-rpc";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class SearchRpcServer implements RpcServer<SearchRpc> {
  readonly namespace = SEARCH_RPC;
  readonly streams = {};
  readonly requests: SearchRequests;

  constructor(settings: SearchSettingsManager) {
    this.requests = {
      get: () => Promise.resolve(settings.get()),
      set: (next) => Promise.resolve(settings.set(next)),
    };
  }
}

/** Owns search settings RPC for one native window. */
export class SearchRpcContribution implements RpcContribution {
  constructor(private readonly _settings: SearchSettingsManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new SearchRpcServer(this._settings));
  }
}
