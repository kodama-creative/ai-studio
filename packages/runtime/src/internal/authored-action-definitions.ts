export function defineToolRuntime<TDefinition extends object>(
  definition: TDefinition
): TDefinition {
  return Object.defineProperty(
    definition,
    Symbol.for("llm-space.tool-definition"),
    {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    }
  );
}

export function defineExecutionEnvToolRuntime<
  TKind extends "bash" | "read" | "write"
>(kind: TKind): {
  readonly kind: TKind;
  readonly [key: symbol]: true;
} {
  return Object.defineProperty(
    { kind },
    Symbol.for("llm-space.execution-env-tool-definition"),
    {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    }
  );
}

export function defineMcpClientConnectionRuntime<
  TDefinition extends {
    readonly tools: { readonly allow: readonly string[]; };
    readonly transport?: "streamableHttp";
  }
>(input: TDefinition): { readonly transport: "streamableHttp"; } & TDefinition {
  if (input.tools.allow.length === 0) {
    throw new TypeError("tools.allow must contain at least one tool name");
  }
  return Object.defineProperty(
    { ...input, transport: input.transport ?? "streamableHttp" },
    Symbol.for("llm-space.mcp-connection-definition"),
    {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    }
  );
}

export function createAuthoredDefinitionVirtualModule(
  exportName: string,
  definition: { toString(): string; }
): string {
  return `export const ${exportName} = ${definition.toString()};`;
}
