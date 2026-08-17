import { ContainerModule, inject, injectable } from "inversify";

import {
  PLAYGROUND_RPC,
  type PlaygroundRequests,
  type PlaygroundRpc,
} from "../../shared/playground-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { WINDOW_CONTEXT_PROVIDER } from "../native/native-window-module";
import { PlaygroundThreadRpcServer } from "../thread/thread-rpc-server";

import { DesktopPlaygroundModelHost } from "./desktop-playground-model-host";
import { DesktopPlaygroundToolHost } from "./desktop-playground-tool-host";
import {
  DesktopPlaygroundApplication,
  PLAYGROUND_MODEL_HOST,
  PLAYGROUND_TOOL_HOST,
} from "./playground-application";

/** Bind the process-owned Playground application host. */
export function playgroundModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(DesktopPlaygroundModelHost).toSelf().inSingletonScope();
    bind(PLAYGROUND_MODEL_HOST).toService(DesktopPlaygroundModelHost);
    bind(DesktopPlaygroundToolHost).toSelf().inSingletonScope();
    bind(PLAYGROUND_TOOL_HOST).toService(DesktopPlaygroundToolHost);
    bind(DesktopPlaygroundApplication)
      .toSelf()
      .inSingletonScope()
      .onDeactivation((application) => application.dispose());
  });
}

/** Identify the Main window as the durable Playground catalog. */
export function playgroundWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_CONTEXT_PROVIDER).toConstantValue({
      getWindowContext: () => ({ kind: "playground" }),
    });
  });
}

@injectable()
class PlaygroundContribution implements RpcContributionApi {
  constructor(
    @inject(DesktopPlaygroundApplication)
    private readonly _application: DesktopPlaygroundApplication
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: PlaygroundRequests = {
      list: () => this._application.listPlaygrounds(),
      create: (input) => this._application.createPlayground(input),
      load: (playgroundId) => this._application.loadPlayground(playgroundId),
      save: (playgroundId, document) =>
        this._application.savePlayground(playgroundId, document),
    };
    rpc.registerServer({
      namespace: PLAYGROUND_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<PlaygroundRpc>);
    rpc.registerServer(new PlaygroundThreadRpcServer(this._application));
  }
}

/** Bind Main-only Playground transport adapters in the window scope. */
export function playgroundContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PlaygroundContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(PlaygroundContribution);
  });
}
