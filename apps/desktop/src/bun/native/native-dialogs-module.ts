import { Utils } from "electrobun/bun";
import { ContainerModule, inject, injectable } from "inversify";

import {
  NATIVE_DIALOGS_RPC,
  type NativeDialogsRpc,
} from "../../shared/native-dialogs-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import {
  importFilesWithNativePicker,
  importTextFromClipboard,
} from "./import-files";

@injectable()
export class NativeDialogsApplication {
  async pickFile() {
    return this._pick(false);
  }

  async pickDirectory() {
    return this._pick(true);
  }

  /** Read selected portable snapshots while Bun owns native file access. */
  pickImportFiles() {
    return importFilesWithNativePicker();
  }

  /** Read clipboard text and project it as one virtual snapshot file. */
  readClipboardImport() {
    return Promise.resolve(importTextFromClipboard());
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

@injectable()
class NativeDialogsContribution implements RpcContributionApi {
  constructor(
    @inject(NativeDialogsApplication)
    private readonly _application: NativeDialogsApplication
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: NATIVE_DIALOGS_RPC,
      requests: this._application,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<NativeDialogsRpc>);
  }
}

/** Bind the process-owned native picker application. */
export function nativeDialogsApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeDialogsApplication).toSelf().inSingletonScope();
  });
}

/** Bind native picker RPC and import commands for one window. */
export function nativeDialogsContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NativeDialogsContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeDialogsContribution
    );
  });
}
