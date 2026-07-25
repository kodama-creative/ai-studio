import type { RuntimeJsonValue, RuntimeRunState } from "./runtime-run";
import type { AgentModelSelector } from "../../shared/agent-definition";

export const RUNTIME_HISTORY_SCHEMA_VERSION = 1 as const;
export const MAX_RUNTIME_BRANCH_LABEL_LENGTH = 80;

export interface RuntimeHistoryMessageEntrySnapshot {
  readonly createdAt: number;
  readonly fingerprint: string;
  readonly id: string;
  readonly message: RuntimeJsonValue;
  readonly parentId: string | null;
  readonly runId: string;
}

export interface RuntimeBranchSnapshot {
  readonly createdAt: number;
  readonly headCheckpointId: string | null;
  readonly id: string;
  readonly label: string;
  readonly ordinal: number;
  readonly parentCheckpointId: string | null;
}

export interface RuntimeCheckpointSnapshot {
  readonly branchId: string;
  readonly continuationFingerprint: string;
  readonly createdAt: number;
  readonly headEntryId: string | null;
  readonly id: string;
  readonly order: number;
  readonly parentCheckpointId: string | null;
  readonly runId: string;
  readonly state: Exclude<RuntimeRunState, "runningModel" | "runningTools">;
}

export interface RuntimeCompactionSnapshot {
  readonly branchId: string;
  readonly contextWindow: number;
  readonly createdAt: number;
  readonly firstKeptEntryId: string;
  readonly id: string;
  readonly model: AgentModelSelector;
  readonly requestFingerprint: string;
  readonly runId: string;
  readonly sourceCheckpointId: string | null;
  readonly sourceHeadEntryId: string;
  readonly summary: string;
  readonly summaryFingerprint: string;
  readonly tokenEvidence: {
    readonly lastUsageMessageIndex: number | null;
    readonly tokensAfter: number;
    readonly tokensBefore: number;
    readonly trailingTokens: number;
    readonly usageTokens: number;
  };
}

export interface RuntimeHistorySnapshot {
  readonly schemaVersion: typeof RUNTIME_HISTORY_SCHEMA_VERSION;
  readonly branches: readonly RuntimeBranchSnapshot[];
  readonly checkpoints: readonly RuntimeCheckpointSnapshot[];
  readonly compactions: readonly RuntimeCompactionSnapshot[];
  readonly currentBranchId: string | null;
  readonly currentCheckpointId: string | null;
  readonly entries: readonly RuntimeHistoryMessageEntrySnapshot[];
}

export interface RuntimeWorkingBase {
  readonly branchId: string;
  readonly checkpointId: string;
}

export function emptyRuntimeHistory(): RuntimeHistorySnapshot {
  return {
    schemaVersion: RUNTIME_HISTORY_SCHEMA_VERSION,
    branches: [],
    checkpoints: [],
    compactions: [],
    currentBranchId: null,
    currentCheckpointId: null,
    entries: []
  };
}

export function runtimeHistoryMessagePath(
  history: RuntimeHistorySnapshot,
  headEntryId: string | null
): readonly RuntimeHistoryMessageEntrySnapshot[] {
  if (headEntryId === null) { return []; }
  const byId = new Map(history.entries.map(entry => [entry.id, entry]));
  const reversed: RuntimeHistoryMessageEntrySnapshot[] = [];
  const seen = new Set<string>();
  let entryId: string | null = headEntryId;
  while (entryId !== null) {
    if (seen.has(entryId)) {
      throw new Error(`Runtime message history contains a cycle at ${entryId}`);
    }
    seen.add(entryId);
    const entry: RuntimeHistoryMessageEntrySnapshot | undefined = byId.get(
      entryId
    );
    if (!entry) {
      throw new Error(`Runtime message history is missing entry ${entryId}`);
    }
    reversed.push(entry);
    entryId = entry.parentId;
  }
  return reversed.reverse();
}

export function runtimeHistoryMessages(
  history: RuntimeHistorySnapshot,
  headEntryId: string | null
): readonly RuntimeJsonValue[] {
  return runtimeHistoryMessagePath(history, headEntryId)
    .map(entry => entry.message);
}

export function runtimeHistoryCheckpointPath(
  history: RuntimeHistorySnapshot,
  checkpointId: string | null
): readonly RuntimeCheckpointSnapshot[] {
  if (checkpointId === null) { return []; }
  const byId = new Map(
    history.checkpoints.map(checkpoint => [checkpoint.id, checkpoint])
  );
  const reversed: RuntimeCheckpointSnapshot[] = [];
  const seen = new Set<string>();
  let currentId: string | null = checkpointId;
  while (currentId !== null) {
    if (seen.has(currentId)) {
      throw new Error(`Runtime checkpoint history contains a cycle at ${currentId}`);
    }
    seen.add(currentId);
    const checkpoint: RuntimeCheckpointSnapshot | undefined = byId.get(
      currentId
    );
    if (!checkpoint) {
      throw new Error(`Runtime checkpoint history is missing ${currentId}`);
    }
    reversed.push(checkpoint);
    currentId = checkpoint.parentCheckpointId;
  }
  return reversed.reverse();
}

export function runtimeBranchContainsCheckpoint(
  history: RuntimeHistorySnapshot,
  branchId: string,
  checkpointId: string
): boolean {
  const branch = history.branches.find(item => item.id === branchId);
  if (!branch?.headCheckpointId) { return false; }
  return runtimeHistoryCheckpointPath(history, branch.headCheckpointId)
    .some(checkpoint => checkpoint.id === checkpointId);
}

export function runtimeEntryIsAncestor(
  history: RuntimeHistorySnapshot,
  ancestorEntryId: string,
  headEntryId: string | null
): boolean {
  return runtimeHistoryMessagePath(history, headEntryId)
    .some(entry => entry.id === ancestorEntryId);
}

export function latestRuntimeCompaction(
  history: RuntimeHistorySnapshot,
  headEntryId: string | null
): RuntimeCompactionSnapshot | null {
  for (let index = history.compactions.length - 1; index >= 0; index -= 1) {
    const compaction = history.compactions[index];
    if (!compaction) { continue; }
    if (
      runtimeEntryIsAncestor(
        history,
        compaction.sourceHeadEntryId,
        headEntryId
      )
      && runtimeEntryIsAncestor(
        history,
        compaction.firstKeptEntryId,
        headEntryId
      )
    ) {
      return compaction;
    }
  }
  return null;
}
