import type { AgentSessionContext } from "../shared/agent-session-context";

const INSTRUCTIONS_BRAND = Symbol.for("llm-space.instructions-definition");
const DYNAMIC_INSTRUCTIONS_KIND = "llm-space:dynamic-instructions" as const;

export interface RuntimeInstructionsDefinition {
  readonly markdown: string;
}

export interface RuntimeDynamicInstructionsDefinition {
  readonly kind: typeof DYNAMIC_INSTRUCTIONS_KIND;
  readonly events: {
    readonly "turn.started": (
      event: { readonly type: "turn.started"; },
      context: { readonly session: AgentSessionContext; }
    ) => Promise<RuntimeInstructionsDefinition | null> | RuntimeInstructionsDefinition | null;
  };
}

export function defineInstructionsRuntime<T extends RuntimeInstructionsDefinition>(
  definition: T
): T {
  return Object.defineProperty(definition, INSTRUCTIONS_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

export function defineDynamicInstructionsRuntime(
  definition: Omit<RuntimeDynamicInstructionsDefinition, "kind">
): RuntimeDynamicInstructionsDefinition {
  return Object.freeze({ kind: DYNAMIC_INSTRUCTIONS_KIND, ...definition });
}

export function isInstructionsDefinition(
  value: unknown
): value is RuntimeInstructionsDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Record<PropertyKey, unknown>)[INSTRUCTIONS_BRAND] === true
    && typeof (value as { markdown?: unknown; }).markdown === "string"
  );
}

export function isDynamicInstructionsDefinition(
  value: unknown
): value is RuntimeDynamicInstructionsDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { kind?: unknown; }).kind === DYNAMIC_INSTRUCTIONS_KIND
    && typeof (value as RuntimeDynamicInstructionsDefinition)
      .events?.["turn.started"] === "function"
  );
}

export function createAuthoredInstructionsVirtualModule(): string {
  const instructionsKey = JSON.stringify(INSTRUCTIONS_BRAND.description);
  return `
    const INSTRUCTIONS_BRAND = Symbol.for(${instructionsKey});
    export const defineInstructions = definition => Object.defineProperty(
      definition,
      INSTRUCTIONS_BRAND,
      { value: true, enumerable: false, configurable: false, writable: false }
    );
    export const defineDynamic = definition => Object.freeze({
      kind: "llm-space:dynamic-instructions",
      ...definition
    });
  `;
}
