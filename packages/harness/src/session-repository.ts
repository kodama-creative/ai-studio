import type { HarnessSessionSnapshot } from "./protocol";

export interface SessionRepository {
  load(sessionId: string): Promise<HarnessSessionSnapshot | undefined>;
  save(snapshot: HarnessSessionSnapshot): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
