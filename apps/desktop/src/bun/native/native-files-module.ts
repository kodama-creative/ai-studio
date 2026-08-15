import { userDirectoryExists } from "@llm-space/core/server";
import type { SkillsManager } from "@llm-space/runtime/skills";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
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
import { bindWindowFeature, windowFeature } from "../di/window-feature";
import { revealResource } from "../fs/reveal-resource";
import { SKILLS_MANAGER } from "../skills/skills-module";

/** Typed Electrobun adapter for the native-files namespace. */
class NativeFilesRpcServer implements RpcServer<NativeFilesRpc> {
  readonly namespace = NATIVE_FILES_RPC;
  readonly streams = {};
  readonly requests: NativeFilesRequests;

  constructor(skills: Pick<SkillsManager, "findSkill">) {
    this.requests = {
      directoryExists: (path) => userDirectoryExists(path),
      reveal: (pathOrLocator) =>
        revealResource(pathOrLocator, { skillsManager: skills }),
    };
  }
}

/** Owns native-files RPC registration for one native window. */
class NativeFilesContribution implements RpcContributionApi {
  private readonly _server: NativeFilesRpcServer;

  constructor(skills: Pick<SkillsManager, "findSkill">) {
    this._server = new NativeFilesRpcServer(skills);
  }

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(this._server);
  }
}

/** Bind native file RPC for one window. */
export function nativeFilesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeFilesContribution)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new NativeFilesContribution(
            context.get<SkillsManager>(SKILLS_MANAGER)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeFilesContribution
    );
  });
}

/** Register native file operations as one bundled window feature. */
export function nativeFilesModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("native-files", (scope) =>
        scope.load(nativeFilesRpcModule())
      )
    );
  });
}
