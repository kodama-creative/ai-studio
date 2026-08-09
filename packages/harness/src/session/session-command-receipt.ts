export interface SessionCommandReceipt {
  readonly sessionId: string;
  readonly commandId: string;
  readonly turnId: string;
  readonly acceptedAt: number;
  readonly deduplicated: boolean;
  /** Event cursor captured before the command was accepted. */
  readonly afterSequence: number;
}
