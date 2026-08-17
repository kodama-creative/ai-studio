import {
  readUserTextFile,
  userTextFileExists,
} from "@llm-space/core/server";
import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
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

class PromptFilesRpcServer implements RpcServer<PromptFilesRpc> {
  readonly namespace = PROMPT_FILES_RPC;
  readonly streams = {};
  readonly requests: PromptFilesRequests = {
    readText: (path) => readUserTextFile(path),
    exists: (path) => userTextFileExists(path),
  };
}

/** Owns guarded prompt-file reads for one native window. */
class PromptFilesRpcContribution implements RpcContributionApi {
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new PromptFilesRpcServer());
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
