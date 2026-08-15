import { Utils } from "electrobun/bun";
import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  NATIVE_DIALOGS_RPC,
  type NativeDialogsRpc,
} from "../../shared/native-dialogs-rpc";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry, CommandSink } from "../di/command-registry";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

import {
  importFilesWithNativePicker,
  importTextFromClipboard,
} from "./import-files";

export const NATIVE_DIALOGS_APPLICATION =
  desktopToken<NativeDialogsApplication>("native-dialogs", "application");

export class NativeDialogsApplication {
  async pickFile() {
    return this._pick(false);
  }

  async pickDirectory() {
    return this._pick(true);
  }

  private async _pick(directory: boolean): Promise<string | null> {
    const selected = await Utils.openFileDialog({
      startingFolder: "~/",
      canChooseFiles: !directory,
      canChooseDirectory: directory,
      allowsMultipleSelection: false,
    });
    return selected.map((value) => value.trim()).find(Boolean) ?? null;
  }
}

class NativeDialogsRpcServer implements RpcServer<NativeDialogsRpc> {
  readonly namespace = NATIVE_DIALOGS_RPC;
  readonly streams = {};

  constructor(readonly requests: NativeDialogsApplication) {}
}

class NativeDialogsContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(
    private readonly _application: NativeDialogsApplication,
    private readonly _commandSink: CommandSink
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NativeDialogsRpcServer(this._application));
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("playground.importFiles", {
      execute: () =>
        importFilesWithNativePicker((next) =>
          this._commandSink.sendToWebview(next)
        ),
    });
    commands.registerCommand("playground.importFromClipboard", {
      execute: () =>
        importTextFromClipboard((next) =>
          this._commandSink.sendToWebview(next)
        ),
    });
  }
}

/** Bind the process-owned native picker application. */
export function nativeDialogsApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<NativeDialogsApplication>(NATIVE_DIALOGS_APPLICATION)
      .to(NativeDialogsApplication)
      .inSingletonScope();
    bindWindowFeature(
      bind,
      windowFeature("native-dialogs", (scope, { commandSink }) =>
        scope.load(nativeDialogsContributionsModule(commandSink))
      )
    );
  });
}

/** Bind native picker RPC and import commands for one window. */
export function nativeDialogsContributionsModule(
  commandSink: CommandSink
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeDialogsContribution)
      .toDynamicValue(
        (context) =>
          new NativeDialogsContribution(
            context.get(NATIVE_DIALOGS_APPLICATION),
            commandSink
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      NativeDialogsContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeDialogsContribution
    );
  });
}
