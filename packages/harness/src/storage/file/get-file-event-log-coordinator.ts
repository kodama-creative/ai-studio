type ReadyCheck = () => Promise<boolean>;

class FileEventLogCoordinator {
  private readonly _appendQueues = new Map<string, Promise<void>>();
  private readonly _waiters = new Map<string, Set<() => void>>();

  async append(path: string, operation: () => Promise<void>): Promise<void> {
    const previous = this._appendQueues.get(path) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this._appendQueues.set(path, current);
    try {
      await current;
    } finally {
      if (this._appendQueues.get(path) === current) {
        this._appendQueues.delete(path);
      }
    }
    this._wake(path);
  }

  async wait(
    path: string,
    signal: AbortSignal | undefined,
    isReady: ReadyCheck
  ): Promise<void> {
    if (signal?.aborted || (await isReady())) return;
    await new Promise<void>((resolve, reject) => {
      let waiters = this._waiters.get(path);
      if (waiters === undefined) {
        waiters = new Set();
        this._waiters.set(path, waiters);
      }
      const cleanup = () => {
        signal?.removeEventListener("abort", wake);
        waiters?.delete(wake);
        if (waiters?.size === 0) this._waiters.delete(path);
      };
      const wake = () => {
        cleanup();
        resolve();
      };
      waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      void isReady().then(
        (ready) => {
          if (ready) wake();
        },
        (error: unknown) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  private _wake(path: string): void {
    const waiters = this._waiters.get(path);
    if (waiters === undefined) return;
    this._waiters.delete(path);
    for (const wake of waiters) wake();
  }
}

const PROCESS_COORDINATOR = new FileEventLogCoordinator();

export function getFileEventLogCoordinator(): FileEventLogCoordinator {
  return PROCESS_COORDINATOR;
}
