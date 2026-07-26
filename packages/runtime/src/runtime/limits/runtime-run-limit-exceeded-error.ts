import type {
  RuntimeRunLimitExceededFailure
} from "../harness/runtime-run";

export class RuntimeRunLimitExceededError extends Error {
  readonly axis = "modelCalls" as const;
  readonly attempted: number;
  readonly code = "runLimitExceeded" as const;
  readonly consumed: number;
  readonly limit: number;

  constructor(failure: RuntimeRunLimitExceededFailure) {
    super(
      `${failure.consumed}/${failure.limit} model calls used. Start a new Run to continue.`
    );
    this.name = "RuntimeRunLimitExceededError";
    this.attempted = failure.attempted;
    this.consumed = failure.consumed;
    this.limit = failure.limit;
  }
}
