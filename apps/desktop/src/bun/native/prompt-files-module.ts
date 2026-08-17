import { readUserTextFile, userTextFileExists } from "@llm-space/core/server";
import { ContainerModule, injectable } from "inversify";

import {
  PROMPT_FILES_RPC,
  type PromptFilesRequests,
  type PromptFilesRpc,
} from "../../shared/prompt-files-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

/** Owns guarded prompt-file reads for one native window. */
@injectable()
class PromptFilesRpcContribution implements RpcContributionApi {
  registerRpc(rpc: RpcRegistry): void {
    const requests: PromptFilesRequests = {
      readText: (path) => readUserTextFile(path),
      exists: (path) => userTextFileExists(path),
    };
    rpc.registerServer({
      namespace: PROMPT_FILES_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<PromptFilesRpc>);
  }
}

/** Bind guarded prompt-file reads as one window RPC contribution. */
export function promptFilesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PromptFilesRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      PromptFilesRpcContribution
    );
  });
}
