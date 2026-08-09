import type { HarnessSessionSnapshot } from "../session/protocol";

export interface SessionRepository {
  create(snapshot: HarnessSessionSnapshot): Promise<"created" | "existing">;
  load(sessionId: string): Promise<HarnessSessionSnapshot | undefined>;
  save(snapshot: HarnessSessionSnapshot): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
