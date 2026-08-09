export class KeyedOperationCoordinator {
  private readonly _operations = new Map<string, Promise<unknown>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this._operations.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this._operations.set(key, current);
    try {
      return await current;
    } finally {
      if (this._operations.get(key) === current) this._operations.delete(key);
    }
  }
}
