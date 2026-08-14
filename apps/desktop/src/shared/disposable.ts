/** Resource with an idempotent, optionally asynchronous lifecycle boundary. */
export interface Disposable {
  dispose(): void | Promise<void>;
}

/** Runtime guard used because TypeScript interfaces are erased. */
export function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<Disposable>).dispose === "function"
  );
}
