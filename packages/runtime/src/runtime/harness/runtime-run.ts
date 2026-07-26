export const RUNTIME_RUN_STATES = [
  "runningModel",
  "runningTools",
  "waitingForApproval",
  "waitingForBudget",
  "waitingForToolResults",
  "waitingForContinue",
  "completed",
  "failed",
  "cancelled",
  "superseded",
  "outcomeUnknown"
] as const;

export type RuntimeRunState = typeof RUNTIME_RUN_STATES[number];

export type RuntimeJsonValue =
  | { readonly [key: string]: RuntimeJsonValue; }
  | boolean
  | number
  | readonly RuntimeJsonValue[]
  | string
  | null;

export interface RuntimeStructuredOutputResult<
  TValue extends RuntimeJsonValue = RuntimeJsonValue
> {
  readonly contract: string;
  readonly schemaFingerprint: string;
  readonly value: TValue;
}

export interface RuntimeRunLimitExceededFailure {
  readonly axis: "modelCalls";
  readonly attempted: number;
  readonly code: "runLimitExceeded";
  readonly consumed: number;
  readonly limit: number;
}

export type RuntimeRunFailure = RuntimeRunLimitExceededFailure;

export interface RuntimeRunCheckpointSnapshot {
  readonly continuationFingerprint: string;
  readonly order: number;
  readonly state: Exclude<RuntimeRunState, "runningModel" | "runningTools">;
}

export interface RuntimeRunSnapshot {
  readonly baseCheckpointId: string | null;
  readonly branchId: string;
  readonly id: string;
  readonly inputHeadEntryId: string | null;
  readonly sessionId: string;
  readonly configurationId: string;
  readonly state: RuntimeRunState;
  readonly checkpoint?: RuntimeRunCheckpointSnapshot;
  readonly failure?: RuntimeRunFailure;
  readonly structuredOutput?: RuntimeStructuredOutputResult;
}

const LEGAL_TRANSITIONS: Readonly<
  Record<RuntimeRunState, ReadonlySet<RuntimeRunState>>
> = {
  runningModel: new Set([
    "runningTools",
    "waitingForBudget",
    "completed",
    "failed",
    "cancelled",
    "superseded",
    "outcomeUnknown"
  ]),
  runningTools: new Set([
    "runningModel",
    "waitingForApproval",
    "waitingForBudget",
    "waitingForToolResults",
    "waitingForContinue",
    "completed",
    "failed",
    "cancelled",
    "superseded",
    "outcomeUnknown"
  ]),
  waitingForApproval: new Set([
    "runningTools",
    "cancelled",
    "superseded"
  ]),
  waitingForBudget: new Set([
    "runningModel",
    "cancelled",
    "superseded"
  ]),
  waitingForToolResults: new Set([
    "waitingForContinue",
    "cancelled",
    "superseded"
  ]),
  waitingForContinue: new Set([
    "runningModel",
    "cancelled",
    "superseded"
  ]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  superseded: new Set(),
  outcomeUnknown: new Set()
};

export class RuntimeRunTransitionError extends Error {
  readonly from: RuntimeRunState;
  readonly to: RuntimeRunState;

  constructor(from: RuntimeRunState, to: RuntimeRunState) {
    super(`Illegal Runtime Run transition: ${from} -> ${to}`);
    this.name = "RuntimeRunTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isTerminalRuntimeRunState(state: RuntimeRunState): boolean {
  return LEGAL_TRANSITIONS[state].size === 0;
}

export function transitionRuntimeRun(
  run: RuntimeRunSnapshot,
  to: RuntimeRunState
): RuntimeRunSnapshot {
  if (!LEGAL_TRANSITIONS[run.state].has(to)) {
    throw new RuntimeRunTransitionError(run.state, to);
  }
  return Object.freeze({ ...run, state: to });
}
