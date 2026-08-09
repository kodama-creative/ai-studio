import type { StudioThreadDocument } from "./studio-thread";

export interface ThreadCheckpoint {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly threadId: string;
  readonly source:
    | { readonly type: "run"; readonly runId: string }
    | { readonly type: "manual" };
  readonly document: StudioThreadDocument;
  readonly createdAt: number;
}
