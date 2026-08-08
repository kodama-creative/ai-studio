import { DISABLED_TOOL_SENTINEL_KIND } from "../shared/types";

export interface DisabledToolSentinel {
  readonly kind: typeof DISABLED_TOOL_SENTINEL_KIND;
}

export function disableTool(): DisabledToolSentinel {
  return { kind: DISABLED_TOOL_SENTINEL_KIND };
}

export function isDisabledToolSentinel(
  value: unknown
): value is DisabledToolSentinel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === DISABLED_TOOL_SENTINEL_KIND
  );
}
