import { expect, mock, test } from "bun:test";

import { Container, ContainerModule } from "inversify";

await mock.module("electrobun/bun", () => ({
  BrowserView: {
    defineRPC: () => ({
      send: {
        executeCommand: () => undefined,
        rpcNamespaceEvent: () => undefined,
        rpcNamespaceStreamEvent: () => undefined,
      },
    }),
  },
}));

const { RpcContribution } = await import("../di/rpc-contribution");
const { windowRegistryModule } = await import("../di/window-registry-module");
const { WindowApplication } = await import("../native/native-window-module");
const {
  DESKTOP_WINDOW_CLOSE,
  DESKTOP_WINDOW_KIND,
  DesktopWindowRuntime,
} = await import("./desktop-window-runtime");

test("window Container composition completes before Registries start", async () => {
  const container = new Container();
  const lifecycle: string[] = ["configure"];
  container
    .bind<Pick<InstanceType<typeof WindowApplication>, "attach" | "dispose">>(
      WindowApplication
    )
    .toConstantValue({
      attach: () => undefined,
      dispose: () => Promise.resolve(),
    });
  container.load(
    new ContainerModule(({ bind }) => {
      bind(RpcContribution).toConstantValue({
        registerRpc: () => lifecycle.push("rpc"),
      });
    }),
    windowRegistryModule({
      rpcEventSink: {
        sendEvent: () => undefined,
        sendStreamEvent: () => undefined,
      },
    })
  );
  container.bind(DESKTOP_WINDOW_KIND).toConstantValue("main");
  container.bind(DESKTOP_WINDOW_CLOSE).toConstantValue({
    requestClose: () => undefined,
  });
  container.bind(DesktopWindowRuntime).toSelf().inSingletonScope();
  const runtime = container.get(DesktopWindowRuntime);

  expect(runtime.rpc).toBeDefined();
  expect(lifecycle).toEqual(["configure"]);
  runtime.start();
  expect(lifecycle).toEqual(["configure", "rpc"]);

  await runtime.dispose();
  await container.unbindAllAsync();
});
