import type { AgentSessionLimitsDefinition } from "@llm-space/runtime";
import type {
  RuntimeRunFailure,
  StoredRuntimeSession
} from "@llm-space/runtime/harness";

export interface ModelCallLimitView {
  readonly failure?: RuntimeRunFailure;
  readonly limit: number;
  readonly reached: boolean;
  readonly used: number;
}

export function modelCallLimitView(
  persisted: unknown,
  sourceLimits?: AgentSessionLimitsDefinition
): ModelCallLimitView | null {
  const session = _session(persisted);
  const active = session?.snapshot.runs.find(
    run => run.id === session.snapshot.activeRunId
  );
  if (active) {
    return _modelCallLimitViewForRun(session, active.id);
  }
  const sourceLimit = sourceLimits?.maxModelCallsPerRun;
  if (typeof sourceLimit !== "number") { return null; }
  const latest = session?.snapshot.runs.findLast(run => {
    const configuration = session.configurations.find(
      item => item.id === run.configurationId
    );
    return configuration?.limits?.maxModelCallsPerRun === sourceLimit;
  });
  return latest
    ? _modelCallLimitViewForRun(session, latest.id)
    : { limit: sourceLimit, reached: false, used: 0 };
}

function _modelCallLimitViewForRun(
  persisted: unknown,
  runId: string
): ModelCallLimitView | null {
  const session = _session(persisted);
  const run = session?.snapshot.runs.find(item => item.id === runId);
  const configuration = session?.configurations.find(
    item => item.id === run?.configurationId
  );
  const limit = configuration?.limits?.maxModelCallsPerRun;
  if (!session || !run || typeof limit !== "number") { return null; }
  const used = (session.snapshot.operationLedger?.steps ?? [])
    .filter(step => step.runId === run.id)
    .flatMap(step => step.operations)
    .filter(operation =>
      operation.kind === "provider"
      && operation.providerSlot === undefined
      && operation.state !== "cancelled").length;
  return {
    limit,
    reached: used >= limit,
    used,
    ...(run.failure ? { failure: run.failure } : {})
  };
}

function _session(value: unknown): StoredRuntimeSession | null {
  const session = value as StoredRuntimeSession | undefined;
  return session?.snapshot.schemaVersion === 6 ? session : null;
}
