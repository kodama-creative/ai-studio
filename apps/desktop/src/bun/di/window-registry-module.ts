import { ContainerModule, type ResolutionContext } from "inversify";

import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "./command-contribution";
import { CommandRegistry, type CommandSink } from "./command-registry";
import {
  ContributionProvider,
  type ContributionProvider as ContributionProviderApi,
  SnapshotContributionProvider,
} from "./contribution-provider";
import type { DesktopWindowScope } from "./process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "./rpc-contribution";
import { RpcRegistry, type RpcEventSink } from "./rpc-registry";

export interface WindowRegistryModuleInput {
  readonly commandSink: CommandSink;
  readonly rpcEventSink: RpcEventSink;
}

/** Bind one immutable contribution snapshot and both Registries per window. */
export function windowRegistryModule(
  scope: DesktopWindowScope,
  input: WindowRegistryModuleInput
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ContributionProviderApi<CommandContributionApi>>(ContributionProvider)
      .toConstantValue(
        new SnapshotContributionProvider(() =>
          scope.getAll<CommandContributionApi>(CommandContribution)
        )
      )
      .whenNamed(CommandContribution);
    bind<ContributionProviderApi<RpcContributionApi>>(ContributionProvider)
      .toConstantValue(
        new SnapshotContributionProvider(() =>
          scope.getAll<RpcContributionApi>(RpcContribution)
        )
      )
      .whenNamed(RpcContribution);
    bind(CommandRegistry)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new CommandRegistry(
            context.get<ContributionProviderApi<CommandContributionApi>>(
              ContributionProvider,
              { name: CommandContribution }
            ),
            input.commandSink
          )
      )
      .inSingletonScope();
    bind(RpcRegistry)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new RpcRegistry(
            context.get<ContributionProviderApi<RpcContributionApi>>(
              ContributionProvider,
              { name: RpcContribution }
            ),
            input.rpcEventSink
          )
      )
      .inSingletonScope();
  });
}
