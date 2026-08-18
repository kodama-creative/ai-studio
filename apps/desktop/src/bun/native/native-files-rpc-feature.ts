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

import { NativeFilesService } from "./native-files-service";

/** Expose native file operations to one renderer RPC registry. */
@injectable()
class NativeFilesRpcContribution implements RpcContributionApi {
  constructor(
    @inject(NativeFilesService)
    private readonly _files: NativeFilesService
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: NativeFilesRequests = {
      directoryExists: (path) =>
        Promise.resolve(this._files.directoryExists(path)),
      reveal: (pathOrLocator) => this._files.revealResource(pathOrLocator),
    };
    rpc.registerServer({
      namespace: NATIVE_FILES_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<NativeFilesRpc>);
  }
}

/** Bind Native Files transport for one window. */
export function nativeFilesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeFilesRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeFilesRpcContribution
    );
  });
}
