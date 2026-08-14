/** Runtime token shared by typed, named contribution providers. */
export const ContributionProvider = Symbol.for(
  "@llm-space/desktop/contribution/provider"
);

/** Read the immutable contribution set assembled for one window scope. */
export interface ContributionProvider<T extends object> {
  getContributions(): readonly T[];
}

/**
 * Resolve contributions lazily so every feature module can finish binding
 * before a Registry starts. The first read freezes the window's extension set.
 */
export class SnapshotContributionProvider<
  T extends object,
> implements ContributionProvider<T> {
  private _snapshot: readonly T[] | undefined;

  constructor(private readonly _resolve: () => readonly T[]) {}

  /** Return one frozen snapshot for the lifetime of the owning window. */
  getContributions(): readonly T[] {
    this._snapshot ??= Object.freeze([...this._resolve()]);
    return this._snapshot;
  }
}
