import { toast } from "sonner";

import { runSettingsMutation } from "@/app/settings/run-settings-mutation";

/** Adapt a fallible catalog intent to a void presentation event. */
export function runModelMutation<T>(
  title: string,
  mutate: () => Promise<T>,
  options: {
    readonly onSuccess?: (value: T) => void;
    readonly onError?: (error: unknown) => void;
  } = {}
): void {
  runSettingsMutation(mutate, {
    onSuccess: options.onSuccess,
    onError: (error) => {
      options.onError?.(error);
      toast.error(title, {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}
