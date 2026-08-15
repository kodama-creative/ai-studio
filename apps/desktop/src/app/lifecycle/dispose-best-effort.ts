import type { Disposable } from "@/shared/disposable";

/** Contain both synchronous and asynchronous cleanup failures during teardown. */
export function disposeBestEffort(
  disposable: Disposable | null | undefined
): void {
  if (disposable === null || disposable === undefined) return;
  try {
    void Promise.resolve(disposable.dispose()).catch(() => undefined);
  } catch {
    // Teardown is best-effort; remaining owners must still be allowed to stop.
  }
}
