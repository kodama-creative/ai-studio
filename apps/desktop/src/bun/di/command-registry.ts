import {
  COMMAND_META,
  type Command,
  type CommandType,
} from "../../shared/commands";
import { isDisposable, type Disposable } from "../../shared/disposable";

import type {
  CommandContribution,
  CommandHandler,
  CommandRegistration,
} from "./command-contribution";
import type { ContributionProvider } from "./contribution-provider";

export interface CommandSink {
  sendToWebview(command: Command): void;
}

interface RegisteredCommandHandler {
  execute(command: Command): void;
}

type RegistryState = "idle" | "starting" | "started" | "disposed";

/** Window-scoped command registry with one owner for every Bun command. */
export class CommandRegistry implements Disposable, CommandRegistration {
  private readonly _handlers = new Map<CommandType, RegisteredCommandHandler>();
  private readonly _registrations: Disposable[] = [];
  private _disposePromise: Promise<void> | undefined;
  private _state: RegistryState = "idle";

  constructor(
    private readonly _contributions: ContributionProvider<CommandContribution>,
    private readonly _sink: CommandSink,
    private readonly _reportError: (
      type: CommandType,
      error: unknown
    ) => void = (type, error) => {
      console.error(`Command "${type}" failed:`, error);
    }
  ) {}

  /** Collect every contribution exactly once, then freeze command ownership. */
  onStart(): void {
    if (this._state !== "idle") {
      throw new Error(
        `CommandRegistry cannot start from state "${this._state}".`
      );
    }
    this._state = "starting";
    try {
      for (const contribution of this._contributions.getContributions()) {
        contribution.registerCommands(this);
      }
      this._state = "started";
    } catch (error) {
      // The window scope remains the authoritative cleanup owner and will
      // await this same idempotent Promise. Attach a rejection handler now so
      // an asynchronous rollback failure cannot become an unhandled task while
      // the synchronous startup error propagates to that owner.
      void this.dispose().catch(() => undefined);
      throw error;
    }
  }

  /** Register one typed handler while contributions are being collected. */
  registerCommand<TType extends CommandType>(
    type: TType,
    handler: CommandHandler<TType>
  ): Disposable {
    if (this._state !== "starting") {
      throw new Error(
        `Command "${type}" can only be registered while CommandRegistry is starting.`
      );
    }
    if (this._handlers.has(type)) {
      throw new Error(`Command handler for "${type}" is already registered.`);
    }
    const registered: RegisteredCommandHandler = {
      // The map key and the dispatch discriminant enforce this narrowing.
      execute: (command) => {
        try {
          void Promise.resolve(
            handler.execute(command as Extract<Command, { type: TType }>)
          ).catch((error: unknown) => this._reportError(type, error));
        } catch (error) {
          this._reportError(type, error);
        }
      },
    };
    this._handlers.set(type, registered);
    const registration: Disposable = {
      dispose: async () => {
        if (this._handlers.get(type) === registered)
          this._handlers.delete(type);
        if (isDisposable(handler)) await handler.dispose();
      },
    };
    this._registrations.push(registration);
    return registration;
  }

  /** Route one command to its Bun owner or across the renderer boundary. */
  execute(command: Command): void {
    if (this._state !== "started") {
      throw new Error(
        `CommandRegistry is not running (state: "${this._state}").`
      );
    }
    const handler = this._handlers.get(command.type);
    if (handler !== undefined) {
      handler.execute(command);
      return;
    }
    if (COMMAND_META[command.type].target === "webview") {
      this._sink.sendToWebview(command);
      return;
    }
    throw new Error(
      `No Bun command handler is registered for "${command.type}".`
    );
  }

  /** Stop dispatch and release registrations in reverse declaration order. */
  dispose(): Promise<void> {
    this._disposePromise ??= this._dispose();
    return this._disposePromise;
  }

  /** Run the idempotent asynchronous cleanup behind {@link dispose}. */
  private async _dispose(): Promise<void> {
    this._state = "disposed";
    const errors: unknown[] = [];
    for (const registration of this._registrations.reverse()) {
      try {
        await registration.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this._registrations.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose Command Registry.");
    }
  }
}
