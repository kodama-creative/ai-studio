import { userDirectoryExists } from "@llm-space/core/server";
import type { SkillsManager } from "@llm-space/runtime/skills";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  NATIVE_FILES_RPC,
  type NativeFilesRpc,
} from "../../shared/native-files-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { revealResource } from "../fs/reveal-resource";

export interface NativeFilesApplication {
  directoryExists(path: string): Promise<boolean>;
  reveal(pathOrLocator: string): Promise<void>;
}

export const NATIVE_FILES_APPLICATION =
  desktopToken<NativeFilesApplication>("native-files", "application");

class NativeFileApplication implements NativeFilesApplication {
  constructor(private readonly _skills: Pick<SkillsManager, "findSkill">) {}

  directoryExists(path: string) {
    return userDirectoryExists(path);
  }

  reveal(pathOrLocator: string) {
    return revealResource(pathOrLocator, { skillsManager: this._skills });
  }
}

class NativeFilesRpcServer implements RpcServer<NativeFilesRpc> {
  readonly namespace = NATIVE_FILES_RPC;
  readonly streams = {};

  constructor(readonly requests: NativeFilesApplication) {}
}

class NativeFilesContribution implements RpcContributionApi {
  constructor(private readonly _application: NativeFilesApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NativeFilesRpcServer(this._application));
  }
}

/** Bind the process-owned native filesystem application. */
export function nativeFilesApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<NativeFilesApplication>(NATIVE_FILES_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new NativeFileApplication(
            context.get<SkillsManager>(PROCESS_TOKENS.skillsManager)
          )
      )
      .inSingletonScope();
  });
}

/** Bind native file RPC for one window. */
export function nativeFilesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeFilesContribution)
      .toDynamicValue(
        (context) =>
          new NativeFilesContribution(context.get(NATIVE_FILES_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeFilesContribution
    );
  });
}
