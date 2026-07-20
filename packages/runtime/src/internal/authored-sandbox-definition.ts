const SANDBOX_DEFINITION_BRAND = Symbol.for("llm-space.sandbox-definition");

export function defineSandboxRuntime(
  input: Readonly<Record<string, never>>
): Readonly<Record<string, never>> {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || Object.keys(input).length > 0
  ) {
    throw new TypeError("defineSandbox({}) does not accept configuration");
  }
  return Object.defineProperty(
    input,
    Symbol.for("llm-space.sandbox-definition"),
    {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    }
  );
}

export function hasSandboxDefinitionBrand(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Record<PropertyKey, unknown>)[SANDBOX_DEFINITION_BRAND] === true
  );
}
