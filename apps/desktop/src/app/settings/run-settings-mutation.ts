export interface SettingsMutationHandlers<T> {
  readonly onSuccess?: (value: T) => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Adapt a fallible async settings intent to a void UI event callback without
 * leaking synchronous throws or Promise rejections into the renderer.
 */
export function runSettingsMutation<T>(
  mutate: () => Promise<T>,
  handlers: SettingsMutationHandlers<T>
): void {
  void Promise.resolve()
    .then(mutate)
    .then(handlers.onSuccess)
    .catch((error: unknown) => {
      try {
        handlers.onError(error);
      } catch {
        // Error presentation must not create a second unhandled failure.
      }
    });
}
