import { createPiRunExecutor } from "@llm-space/engine-pi";
import type { ModelManager } from "@llm-space/runtime/models";
import type { RuntimeRouter } from "@llm-space/runtime/runtime";
import { createStudio } from "@llm-space/studio/server";
import type { BrowserWindow } from "electrobun/bun";
import {
  ContainerModule,
  type ResolutionContext,
  type ServiceIdentifier,
} from "inversify";

import type { AgentProjectView } from "../../shared/agent-project";
import { DesktopPlaygroundApplicationImpl } from "../application/playground-application";
import { createPlaygroundHost } from "../playgrounds/playground-host";
import type { AgentProject } from "../projects/agent-project";
import { ProjectSandbox } from "../projects/project-sandbox";
import type { MainWindowRPCController } from "../rpc";
import { PlaygroundRpcServer } from "../rpc/playground-rpc-server";
import { ProjectRpcServer } from "../rpc/project-rpc-server";

import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "./rpc-contribution";
import {
  PROCESS_TOKENS,
  PROJECT_WINDOW_TOKENS,
  type DesktopToken,
  WINDOW_TOKENS,
} from "./tokens";

type TokenValue<T> = T extends DesktopToken<infer TValue> ? TValue : never;
type ProcessServices = {
  readonly [TKey in Exclude<
    keyof typeof PROCESS_TOKENS,
    "playgroundApplication" | "playgroundHost"
  >]: TokenValue<
    (typeof PROCESS_TOKENS)[TKey]
  >;
};

/** Bind already-constructed process singletons without decorators. */
export function processModule(services: ProcessServices): ContainerModule {
  return new ContainerModule(({ bind }) => {
    for (const key of Object.keys(services) as (keyof ProcessServices)[]) {
      const token = PROCESS_TOKENS[key];
      bind(token as ServiceIdentifier<unknown>).toConstantValue(services[key]);
    }
    bind(PROCESS_TOKENS.playgroundHost)
      .toDynamicValue((context: ResolutionContext) => {
        const modelManager = context.get<ModelManager>(
          PROCESS_TOKENS.modelManager
        );
        const runtimeRouter = context.get<RuntimeRouter>(
          PROCESS_TOKENS.runtimeRouter
        );
        return createPlaygroundHost({
          homePath: context.get(PROCESS_TOKENS.homePath),
          runExecutor: createPiRunExecutor({
            models: () => modelManager.getAvailableModels(),
            resolveConnection: ({ providerId }) =>
              modelManager.resolveConnection({ providerId }),
          }),
          runtime: runtimeRouter.get("local"),
        });
      })
      .inSingletonScope();
    bind(PROCESS_TOKENS.playgroundApplication)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new DesktopPlaygroundApplicationImpl(
            context.get(PROCESS_TOKENS.playgroundHost)
          )
      )
      .inSingletonScope();
    bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
      id: "playground.rpc",
      windows: ["main"],
      create: (scope) =>
        new PlaygroundRpcServer(
          scope.get(PROCESS_TOKENS.playgroundApplication)
        ),
    });
    bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
      id: "project-studio.rpc",
      windows: ["project"],
      create: (scope) =>
        new ProjectRpcServer(scope.get(PROJECT_WINDOW_TOKENS.studio)),
    });
  });
}

/** Bind the native window and RPC resources common to every window kind. */
export function windowModule(input: {
  readonly window: BrowserWindow;
  readonly rpcController: MainWindowRPCController;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.browserWindow).toConstantValue(input.window);
    bind(WINDOW_TOKENS.rpc).toConstantValue(input.rpcController.rpc);
  });
}

/** Main currently adds no private service beyond the common window module. */
export function mainWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.context).toConstantValue({ kind: "playground" });
  });
}

/** Bind one Project Studio and its immutable renderer-facing identity. */
export function projectWindowModule(input: {
  readonly source: AgentProject;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PROJECT_WINDOW_TOKENS.source).toConstantValue(input.source);
    bind(PROJECT_WINDOW_TOKENS.studio)
      .toDynamicValue(async (context: ResolutionContext) => {
        const source = context.get<AgentProject>(
          PROJECT_WINDOW_TOKENS.source
        );
        const modelManager = context.get<ModelManager>(
          PROCESS_TOKENS.modelManager
        );
        return createStudio({
          projectRoot: source.rootPath,
          dataRoot: source.studioStateRoot,
          models: () => modelManager.getAvailableModels(),
          resolveConnection: ({ providerId }) =>
            modelManager.resolveConnection({ providerId }),
          runtimeServices: { sandbox: new ProjectSandbox(source.rootPath) },
        }).then((studio) =>
          Object.assign(studio, { dispose: () => studio.close() })
        );
      })
      .inSingletonScope();
  });
}

/** Bind renderer identity only after the async Studio reveals its Agent ids. */
export function projectWindowIdentityModule(
  project: AgentProjectView
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.context).toConstantValue({
      kind: "agentProject",
      project,
    });
    bind(PROJECT_WINDOW_TOKENS.project).toConstantValue(project);
  });
}
