const OUTPUT_DEFINITION_BRAND = Symbol.for("llm-space.output-definition");

export function defineOutputRuntime<T extends object>(definition: T): T {
  return Object.defineProperty(
    definition,
    Symbol.for("llm-space.output-definition"),
    {
      value: true,
      enumerable: false
    }
  );
}

export function hasOutputDefinitionBrand(value: unknown): boolean {
  return Boolean(value && typeof value === "object"
    && (value as Record<PropertyKey, unknown>)[OUTPUT_DEFINITION_BRAND] === true);
}
