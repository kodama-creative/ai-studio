import { hasOnlyDynamicTurnStarted } from "./authored-dynamic-turn";

import type {
  DynamicResolveContext,
  DynamicTurnEvent
} from "./authored-dynamic-turn";
import type { ToolDefinition } from "../public/definitions/tool";

const DYNAMIC_TOOLS_KIND = "llm-space:dynamic-tools" as const;

export type DynamicToolResult =
  | Readonly<Record<string, ToolDefinition>>
  | ToolDefinition
  | null;

export interface RuntimeDynamicToolsDefinition {
  readonly kind: typeof DYNAMIC_TOOLS_KIND;
  readonly events: {
    readonly "turn.started": (
      event: DynamicTurnEvent,
      context: DynamicResolveContext
    ) => DynamicToolResult | Promise<DynamicToolResult>;
  };
}

export function defineDynamicToolsRuntime(
  definition: Omit<RuntimeDynamicToolsDefinition, "kind">
): RuntimeDynamicToolsDefinition {
  return Object.freeze({ kind: DYNAMIC_TOOLS_KIND, ...definition });
}

export function isDynamicToolsDefinition(
  value: unknown
): value is RuntimeDynamicToolsDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { kind?: unknown; }).kind === DYNAMIC_TOOLS_KIND
    && hasOnlyDynamicTurnStarted(
      (value as RuntimeDynamicToolsDefinition).events
    )
  );
}

export function createAuthoredToolsVirtualModule(
  defineToolSource: string
): string {
  return `${defineToolSource}
    export const defineDynamic = definition => Object.freeze({
      kind: "${DYNAMIC_TOOLS_KIND}",
      ...definition
    });
  `;
}
