import { userDirectoryExists } from "@llm-space/core/server";
import { SkillsManager } from "@llm-space/runtime/skills";
import { ContainerModule, inject, injectable } from "inversify";

import {
  NATIVE_FILES_RPC,
  type NativeFilesRequests,
  type NativeFilesRpc,
} from "../../shared/native-files-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { revealResource } from "../fs/reveal-resource";

/** Owns native-files RPC registration for one native window. */
@injectable()
class NativeFilesContribution implements RpcContributionApi {
  constructor(
    @inject(SkillsManager)
    private readonly _skills: Pick<SkillsManager, "findSkill">
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: NativeFilesRequests = {
      directoryExists: (path) => userDirectoryExists(path),
      reveal: (pathOrLocator) =>
        revealResource(pathOrLocator, { skillsManager: this._skills }),
    };
    rpc.registerServer({
      namespace: NATIVE_FILES_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<NativeFilesRpc>);
  }
}

/** Bind native file RPC for one window. */
export function nativeFilesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeFilesContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeFilesContribution
    );
  });
}
