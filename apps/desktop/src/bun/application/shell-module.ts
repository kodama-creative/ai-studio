import { Utils } from "electrobun/bun";
import { ContainerModule } from "inversify";

import { isChineseLocale } from "../app/locales";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import { parseExternalUrl } from "../parse-external-url";

const DOCS_URL =
  "https://github.com/deer-flow/llm-space/blob/main/docs/index.md";
const DOCS_ZH_CN_URL = "https://my.feishu.cn/wiki/QnGGwGkoti8nwok2cEOc2oMvnrd";
const ISSUES_URL = "https://github.com/deer-flow/llm-space/issues";

class ShellContribution implements CommandContributionApi {
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("shell.openLink", {
      execute: (command) => {
        try {
          Utils.openExternal(parseExternalUrl(command.args.url).href);
        } catch {
          console.error("Blocked unsafe external URL.");
        }
      },
    });
    commands.registerCommand("shell.openDocument", {
      execute: () =>
        Utils.openExternal(isChineseLocale() ? DOCS_ZH_CN_URL : DOCS_URL),
    });
    commands.registerCommand("shell.reportBugs", {
      execute: () => Utils.openExternal(ISSUES_URL),
    });
  }
}

/** Bind native shell commands for one window. */
export function shellCommandsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ShellContribution).toSelf().inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      ShellContribution
    );
  });
}
