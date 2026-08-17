import { expect, mock, test } from "bun:test";

import {
  Container,
  ContainerModule,
  type ServiceIdentifier,
} from "inversify";

import type { RpcContribution as RpcContributionApi } from "../di/rpc-contribution";

await mock.module("electrobun/bun", () => ({
  default: { events: { on: () => undefined } },
  app: {},
  ApplicationMenu: {},
  BrowserWindow: class {},
  BrowserView: {
    defineRPC: () => ({
      send: {
        executeCommand: () => undefined,
        rpcNamespaceEvent: () => undefined,
        rpcNamespaceStreamEvent: () => undefined,
      },
    }),
  },
  Updater: class {},
  Utils: {},
}));

const { ANALYTICS } = await import("../analytics/analytics-module");
const { GITHUB_AUTH } = await import("../auth/github-account-module");
const { AuxiliaryGenerationApplication } = await import(
  "../auxiliary-generation/auxiliary-generation-application"
);
const { RpcContribution } = await import("../di/rpc-contribution");
const { windowRegistryModule } = await import("../di/window-registry-module");
const { DESKTOP_HOST } = await import("../host/desktop-host-module");
const { MCP_MANAGER } = await import("../mcp/mcp-module");
const { ModelsService } = await import("../models/models-service");
const { APP_HOME_PATH } = await import("../native/app-directories-module");
const { NativeDialogsApplication } = await import(
  "../native/native-dialogs-module"
);
const {
  WINDOW_APPLICATION,
  WINDOW_CONTEXT_PROVIDER,
  WINDOW_STATE_MANAGER,
} = await import("../native/native-window-module");
const { NETWORK_SETTINGS } = await import("../network/network-module");
const { DesktopPlaygroundApplication } = await import(
  "../playgrounds/playground-application"
);
const { AgentProjectsApplication } = await import(
  "../projects/agent-projects-application"
);
const { ProjectService } = await import("../projects/project-module");
const { RemindersState } = await import("../reminders/state");
const { SEARCH_SETTINGS } = await import("../search/search-module");
const { SKILLS_MANAGER } = await import("../skills/skills-module");
const { ThreadSharingApplication } = await import(
  "../thread-sharing/thread-sharing-application"
);
const { UPDATER } = await import("../updates/updates-module");
const { createDesktopWindowComposition } = await import("./bootstrap");
const {
  DESKTOP_WINDOW_CLOSE,
  DESKTOP_WINDOW_KIND,
  DesktopWindowRuntime,
} = await import("./desktop-window-runtime");

test("window Container composition completes before Registries start", async () => {
  const container = new Container();
  const lifecycle: string[] = [];
  lifecycle.push("configure");
  container.bind(WINDOW_APPLICATION).toConstantValue({
    attach: () => undefined,
  });
  container.load(
    new ContainerModule(({ bind }) => {
      bind(RpcContribution).toConstantValue({
        registerRpc: () => lifecycle.push("rpc"),
      });
    })
  );
  container.load(
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

test("production composition keeps Common, Main, and Project contributions explicit", async () => {
  const composition = await createDesktopWindowComposition();
  const configureDesktopWindowContainer = composition.configureRuntime.bind(
    composition
  );
  const desktop = new Container();
  const bindConstant = <T>(token: ServiceIdentifier<T>, value: T) =>
    desktop.bind(token).toConstantValue(value);
  bindConstant(ANALYTICS, {});
  bindConstant(GITHUB_AUTH, {});
  bindConstant(AuxiliaryGenerationApplication, {} as never);
  bindConstant(DESKTOP_HOST, {});
  bindConstant(MCP_MANAGER, {});
  bindConstant(ModelsService, {} as never);
  bindConstant(APP_HOME_PATH, "/tmp/llm-space-test");
  bindConstant(NativeDialogsApplication, {} as never);
  bindConstant(NETWORK_SETTINGS, {});
  bindConstant(DesktopPlaygroundApplication, {} as never);
  bindConstant(AgentProjectsApplication, {} as never);
  bindConstant(RemindersState, {} as never);
  bindConstant(SEARCH_SETTINGS, {});
  bindConstant(SKILLS_MANAGER, {});
  bindConstant(ThreadSharingApplication, {} as never);
  bindConstant(UPDATER, {});
  bindConstant(WINDOW_STATE_MANAGER, {});

  const contributionNames = (kind: "main" | "project") => {
    const container = new Container({ parent: desktop });
    container.bind(WINDOW_CONTEXT_PROVIDER).toConstantValue({
      getWindowContext: () =>
        kind === "main"
          ? ({ kind: "playground" } as const)
          : ({ kind: "agentProject", project: {} as never } as const),
    });
    if (kind === "project") {
      container.bind(ProjectService).toConstantValue({
        studio: {},
        projectView: { id: "project" },
      } as unknown as InstanceType<typeof ProjectService>);
    }
    configureDesktopWindowContainer(container, {
      kind,
      rpcEventSink: {
        sendEvent: () => undefined,
        sendStreamEvent: () => undefined,
      },
    });
    return {
      rpc: container
        .getAll<RpcContributionApi>(RpcContribution, { chained: true })
        .map((value) => value.constructor.name),
    };
  };

  const main = contributionNames("main");
  const project = contributionNames("project");

  expect(main.rpc).toContain("AgentProjectsRpcContribution");
  expect(main.rpc).toContain("PlaygroundContribution");
  expect(main.rpc).not.toContain("ProjectContribution");
  expect(project.rpc).toContain("AgentProjectsRpcContribution");
  expect(project.rpc).not.toContain("PlaygroundContribution");
  expect(project.rpc).toContain("ProjectContribution");
  expect(
    main.rpc.filter(
      (name) =>
        name !== "PlaygroundContribution"
    )
  ).toEqual(project.rpc.filter((name) => name !== "ProjectContribution"));

  await desktop.unbindAllAsync();
});
