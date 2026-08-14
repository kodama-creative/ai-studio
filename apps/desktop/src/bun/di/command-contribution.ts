import type { CommandRegistry } from "./command-registry";

/** Multi-binding token for window-owned command declarations. */
export const CommandContribution = Symbol.for(
  "@llm-space/desktop/command/contribution"
);

/** Theia-style command declaration owned by one feature class. */
export interface CommandContribution {
  registerCommands(commands: CommandRegistry): void;
}
