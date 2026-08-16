import type { RendererLifecycleContribution } from "@/app/di/lifecycle";
import { electrobun } from "@/lib/electrobun";
import {
  COMMAND_META,
  type Command,
  type CommandArgs,
  type CommandType,
} from "@/shared/commands";

export type CommandHandlers = {
  [T in CommandType]?: (args: CommandArgs<T>) => void | Promise<void>;
};

type StoredHandler = (args: unknown) => void | Promise<void>;

/** Window-scoped command registry shared by native and renderer entry points. */
export class RendererCommandRegistry implements RendererLifecycleContribution {
  private readonly _handlers = new Map<CommandType, StoredHandler>();
  private _started = false;

  start(): void {
    if (this._started) return;
    this._started = true;
    electrobun.rpc?.addMessageListener("executeCommand", this.executeCommand);
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
    electrobun.rpc?.removeMessageListener(
      "executeCommand",
      this.executeCommand
    );
    this._handlers.clear();
  }

  readonly executeCommand = (command: Command): void => {
    if (COMMAND_META[command.type].target === "bun") {
      electrobun.rpc?.send.executeCommand(command);
      return;
    }
    const handler = this._handlers.get(command.type);
    if (!handler) {
      console.warn(`No handler registered for command: ${command.type}`);
      return;
    }
    _executeHandler(command.type, handler, command.args);
  };

  readonly registerCommandHandlers = (
    handlers: CommandHandlers
  ): (() => void) => {
    const entries = Object.entries(handlers) as [CommandType, StoredHandler][];
    for (const [type, handler] of entries) this._handlers.set(type, handler);
    return () => {
      for (const [type, handler] of entries) {
        if (this._handlers.get(type) === handler) this._handlers.delete(type);
      }
    };
  };
}

function _executeHandler(
  type: CommandType,
  handler: StoredHandler,
  args: unknown
): void {
  try {
    void Promise.resolve(handler(args)).catch((error: unknown) => {
      console.error(`Command "${type}" failed:`, error);
    });
  } catch (error) {
    console.error(`Command "${type}" failed:`, error);
  }
}
