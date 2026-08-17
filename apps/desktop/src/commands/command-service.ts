import type { Command } from "@/shared/commands";

import type { CommandHandlers } from "./renderer-command-registry";

export const COMMAND_SERVICE = Symbol("CommandService");

/** Renderer command port consumed without importing the Electrobun adapter. */
export interface CommandService {
  executeCommand(command: Command): void;
  registerCommandHandlers(handlers: CommandHandlers): () => void;
}
