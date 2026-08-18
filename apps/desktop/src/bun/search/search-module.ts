import { SearchSettingsManager } from "@llm-space/runtime/search";
import { ContainerModule, inject, injectable } from "inversify";

import {
  SEARCH_RPC,
  type SearchRequests,
  type SearchRpc,
} from "../../shared/search-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

/** Owns search settings RPC for one native window. */
@injectable()
class SearchRpcContribution implements RpcContributionApi {
  constructor(
    @inject(SearchSettingsManager)
    private readonly _settings: SearchSettingsManager
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: SearchRequests = {
      get: () => Promise.resolve(this._settings.get()),
      set: (next) => Promise.resolve(this._settings.set(next)),
    };
    rpc.registerServer({
      namespace: SEARCH_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<SearchRpc>);
  }
}

/** Bind search settings RPC as one window contribution. */
export function searchRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SearchRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(SearchRpcContribution);
  });
}
