import type { HarnessPrincipal } from "./harness-principal";
import type { SessionCommandSource } from "./session-command-source";

export interface SessionCommand {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly message: string;
  readonly principal: HarnessPrincipal | null;
  readonly source?: SessionCommandSource;
  readonly createdAt: number;
  readonly sequence: number;
}
