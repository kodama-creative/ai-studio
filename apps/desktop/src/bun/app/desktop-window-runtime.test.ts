import { expect, mock, test } from "bun:test";

import { ContainerModule } from "inversify";

import type { CommandContribution as CommandContributionApi } from "../di/command-contribution";
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
const { CommandContribution } = await import("../di/command-contribution");
const { createDesktopProcessContainer } = await import(
  "../di/process-container"
);
const { RpcContribution } = await import("../di/rpc-contribution");
const { DESKTOP_HOST } = await import("../host/desktop-host-module");
const { MCP_MANAGER } = await import("../mcp/mcp-module");
const { ModelsApplication } = await import("../models/models-application");
const { APP_HOME_PATH } = await import("../native/app-directories-module");
const { NATIVE_DIALOGS_APPLICATION } = await import(
  "../native/native-dialogs-module"
);
const { WINDOW_APPLICATION, WINDOW_CONTEXT, WINDOW_STATE_MANAGER } = await import(
  "../native/native-window-module"
);
const { NETWORK_SETTINGS } = await import("../network/network-module");
const { PLAYGROUND_APPLICATION } = await import(
  "../playgrounds/playground-module"
);
const { AGENT_PROJECTS_APPLICATION } = await import(
  "../projects/agent-projects-module"
);
const { PROJECT_STUDIO, PROJECT_VIEW } = await import(
  "../projects/project-module"
);
const { RemindersState } = await import("../reminders/state");
const { SEARCH_SETTINGS } = await import("../search/search-module");
const { SKILLS_MANAGER } = await import("../skills/skills-module");
const { ThreadSharingApplication } = await import(
  "../thread-sharing/thread-sharing-application"
);
const { UPDATER } = await import("../updates/updates-module");
const { configureDesktopWindowScope } = await import("./desktop-app");
const { DesktopWindowRuntime } = await import("./desktop-window-runtime");

test("window scope configuration completes before Registry snapshots start", async () => {
  const process = createDesktopProcessContainer();
  const scope = process.createWindowScope("main");
  const lifecycle: string[] = [];

  const runtime = new DesktopWindowRuntime(scope, "main", (windowScope) => {
    lifecycle.push("configure");
    windowScope.bindConstant(WINDOW_APPLICATION, {
      attach: () => undefined,
    } as never);
    windowScope.load(
      new ContainerModule(({ bind }) => {
        bind(CommandContribution).toConstantValue({
          registerCommands: () => lifecycle.push("commands"),
        });
        bind(RpcContribution).toConstantValue({
          registerRpc: () => lifecycle.push("rpc"),
        });
      })
    );
  });

  expect(runtime.rpc).toBeDefined();
  expect(lifecycle).toEqual(["configure", "commands", "rpc"]);

  await scope.dispose();
  await process.dispose();
});

test("production composition keeps Common, Main, and Project contributions explicit", async () => {
  const process = createDesktopProcessContainer();
  process.bindConstant(ANALYTICS, {} as never);
  process.bindConstant(GITHUB_AUTH, {} as never);
  process.bindConstant(AuxiliaryGenerationApplication, {} as never);
  process.bindConstant(DESKTOP_HOST, {} as never);
  process.bindConstant(MCP_MANAGER, {} as never);
  process.bindConstant(ModelsApplication, {} as never);
  process.bindConstant(APP_HOME_PATH, "/tmp/llm-space-test");
  process.bindConstant(NATIVE_DIALOGS_APPLICATION, {} as never);
  process.bindConstant(NETWORK_SETTINGS, {} as never);
  process.bindConstant(PLAYGROUND_APPLICATION, {} as never);
  process.bindConstant(AGENT_PROJECTS_APPLICATION, {} as never);
  process.bindConstant(RemindersState, {} as never);
  process.bindConstant(SEARCH_SETTINGS, {} as never);
  process.bindConstant(SKILLS_MANAGER, {} as never);
  process.bindConstant(ThreadSharingApplication, {} as never);
  process.bindConstant(UPDATER, {} as never);
  process.bindConstant(WINDOW_STATE_MANAGER, {} as never);

  const contributionNames = (kind: "main" | "project") => {
    const scope = process.createWindowScope(kind);
    scope.bindConstant(
      WINDOW_CONTEXT,
      kind === "main"
        ? { kind: "playground" }
        : { kind: "agentProject", project: {} as never }
    );
    if (kind === "project") {
      scope.bindConstant(PROJECT_STUDIO, {} as never);
      scope.bindConstant(PROJECT_VIEW, { id: "project" } as never);
    }
    configureDesktopWindowScope(scope, {
      kind,
      commandSink: { sendToWebview: () => undefined },
    });
    return {
      commands: scope
        .getAll<CommandContributionApi>(CommandContribution)
        .map((value) => value.constructor.name),
      rpc: scope
        .getAll<RpcContributionApi>(RpcContribution)
        .map((value) => value.constructor.name),
    };
  };

  const main = contributionNames("main");
  const project = contributionNames("project");

  expect(main.commands).toEqual(project.commands);
  expect(main.commands).toContain("AgentProjectsCommandContribution");
  expect(main.rpc).toContain("AgentProjectsRpcContribution");
  expect(main.rpc).toContain("PlaygroundContribution");
  expect(main.rpc).not.toContain("ProjectContribution");
  expect(project.rpc).not.toContain("AgentProjectsRpcContribution");
  expect(project.rpc).not.toContain("PlaygroundContribution");
  expect(project.rpc).toContain("ProjectContribution");
  expect(
    main.rpc.filter(
      (name) =>
        name !== "AgentProjectsRpcContribution" &&
        name !== "PlaygroundContribution"
    )
  ).toEqual(project.rpc.filter((name) => name !== "ProjectContribution"));

  await process.dispose();
});
