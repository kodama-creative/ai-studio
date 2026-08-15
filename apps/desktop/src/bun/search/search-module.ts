import type { SearchSettingsManager } from "@llm-space/runtime/search";
import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
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
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

export const SEARCH_SETTINGS = desktopToken<SearchSettingsManager>(
  "search",
  "settings"
);

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
class SearchRpcContribution implements RpcContributionApi {
  constructor(private readonly _settings: SearchSettingsManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new SearchRpcServer(this._settings));
  }
}

/** Bind search settings RPC as one window contribution. */
export function searchRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(SearchRpcContribution)
      .toDynamicValue(
        (context) =>
          new SearchRpcContribution(
            context.get<SearchSettingsManager>(SEARCH_SETTINGS)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(SearchRpcContribution);
  });
}

/** Register search settings RPC as one bundled window feature. */
export function searchModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("search", (scope) => scope.load(searchRpcModule()))
    );
  });
}
