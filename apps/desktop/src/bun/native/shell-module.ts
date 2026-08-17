import { Utils } from "electrobun/bun";
import { ContainerModule, inject, injectable } from "inversify";

import { SHELL_RPC, type ShellRequests, type ShellRpc } from "../../shared/shell-rpc";
import { isChineseLocale } from "../app/locales";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { parseExternalUrl } from "./parse-external-url";

const DOCS_URL =
  "https://github.com/deer-flow/llm-space/blob/main/docs/index.md";
const DOCS_ZH_CN_URL = "https://my.feishu.cn/wiki/QnGGwGkoti8nwok2cEOc2oMvnrd";
const ISSUES_URL = "https://github.com/deer-flow/llm-space/issues";

/** Native shell capability exposed only through its typed RPC namespace. */
@injectable()
class ShellService implements ShellRequests {
  openLink(url: string): Promise<void> {
    try {
      Utils.openExternal(parseExternalUrl(url).href);
    } catch {
      console.error("Blocked unsafe external URL.");
    }
    return Promise.resolve();
  }

  openDocument(): Promise<void> {
    Utils.openExternal(isChineseLocale() ? DOCS_ZH_CN_URL : DOCS_URL);
    return Promise.resolve();
  }

  reportBugs(): Promise<void> {
    Utils.openExternal(ISSUES_URL);
    return Promise.resolve();
  }
}

@injectable()
class ShellRpcContribution implements RpcContributionApi {
  constructor(@inject(ShellService) private readonly _service: ShellService) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: SHELL_RPC,
      requests: this._service,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<ShellRpc>);
  }
}

/** Bind one native Shell Service and its RPC contribution per window. */
export function shellRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ShellService).toSelf().inSingletonScope();
    bind(ShellRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(ShellRpcContribution);
  });
}
