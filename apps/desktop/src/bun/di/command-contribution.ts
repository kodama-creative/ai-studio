import type {
  Command,
  CommandType,
} from "../../shared/commands";
import type { Disposable } from "../../shared/disposable";

/** Feature-owned handler for one discriminated command type. */
export interface CommandHandler<TType extends CommandType = CommandType> {
  /** The registry ignores results but contains synchronous/async failures. */
  execute(command: Extract<Command, { type: TType }>): unknown;
}

/** Narrow registration port exposed to feature-owned command contributions. */
export interface CommandRegistration {
  registerCommand<TType extends CommandType>(
    type: TType,
    handler: CommandHandler<TType>
  ): Disposable;
}

/** Multi-binding token for window-owned command declarations. */
export const CommandContribution = Symbol.for(
  "@llm-space/desktop/command/contribution"
);

/** Theia-style command declaration owned by one feature class. */
export interface CommandContribution {
  registerCommands(commands: CommandRegistration): void;
}
