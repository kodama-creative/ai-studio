import type { Run, RunOwner } from "./run";

export interface RunRepository {
  create(run: Run): Promise<"created" | "existing">;
  load(runId: string): Promise<Run | undefined>;
  save(run: Run): Promise<void>;
  listByOwner(owner: RunOwner): Promise<readonly Run[]>;
}
