import { ContainerModule } from "inversify";

import {
  RpcRegistry,
  RpcEventSink,
  type RpcEventSink as RpcEventSinkApi,
} from "./rpc-registry";

export interface WindowRegistryModuleInput {
  readonly rpcEventSink: RpcEventSinkApi;
}

/** Bind transport sinks and both contribution-backed Registries per window. */
export function windowRegistryModule(
  input: WindowRegistryModuleInput
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<RpcEventSinkApi>(RpcEventSink).toConstantValue(input.rpcEventSink);
    bind(RpcRegistry).toSelf().inSingletonScope();
  });
}
