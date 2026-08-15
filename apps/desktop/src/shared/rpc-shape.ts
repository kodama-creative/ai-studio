export interface RequestRpcShape<TRequests extends object> {
  readonly requests: TRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}
