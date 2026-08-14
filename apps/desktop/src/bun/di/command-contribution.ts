import type { BrowserWindow } from "electrobun/bun";

import {
  COMMAND_META,
  type Command,
  type CommandType,
} from "../../shared/commands";

import type { DesktopWindowScope } from "./process-container";
import type { DesktopWindowKind } from "./rpc-contribution";

export interface CommandHandlerContext {
  readonly window: () => BrowserWindow;
  readonly sendToWebview: (command: Command) => void;
}

export interface CommandHandler {
  readonly commands: readonly CommandType[];
  execute(command: Command): void;
}

export interface CommandHandlerContribution {
  readonly id: `${string}.${string}`;
  readonly windows: readonly DesktopWindowKind[];
  create(
    scope: DesktopWindowScope,
    context: CommandHandlerContext
  ): CommandHandler;
}

/** Window-owned command dispatcher assembled from independently registered handlers. */
export class WindowCommandBus {
  private readonly _handlers = new Map<CommandType, CommandHandler>();

  constructor(
    scope: DesktopWindowScope,
    contributions: readonly CommandHandlerContribution[],
    kind: DesktopWindowKind,
    private readonly _context: CommandHandlerContext
  ) {
    const contributionIds = new Set<string>();
    for (const contribution of contributions) {
      if (!contribution.windows.includes(kind)) continue;
      if (contributionIds.has(contribution.id)) {
        throw new Error(
          `Command contribution "${contribution.id}" is duplicated.`
        );
      }
      contributionIds.add(contribution.id);
      const handler = contribution.create(scope, this._context);
      for (const command of handler.commands) {
        if (this._handlers.has(command)) {
          throw new Error(`Command handler for "${command}" is duplicated.`);
        }
        this._handlers.set(command, handler);
      }
    }
  }

  /** Route renderer commands back to the renderer and Bun commands to one owner. */
  execute(command: Command): void {
    const handler = this._handlers.get(command.type);
    if (handler !== undefined) {
      handler.execute(command);
      return;
    }
    if (COMMAND_META[command.type].target === "webview") {
      this._context.sendToWebview(command);
      return;
    }
    throw new Error(
      `No Bun command handler is registered for "${command.type}".`
    );
  }
}

export const COMMAND_HANDLER_CONTRIBUTION = Symbol.for(
  "@llm-space/desktop/command/contribution/handler"
);
