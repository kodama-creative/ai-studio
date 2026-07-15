const MCP_CONNECTION_DEFINITION_BRAND = Symbol.for(
  "llm-space.mcp-connection-definition"
);

export type McpRemoteTransport = "streamableHttp" | "sse";

export interface ConnectionContext {
  readonly abortSignal: AbortSignal;
  readonly connectionName: string;
  readonly url: string;
}

export interface ConnectionToken {
  readonly token: string;
}

export type ConnectionAuthResolver = (
  context: ConnectionContext
) =>
  | ConnectionToken
  | undefined
  | Promise<ConnectionToken | undefined>;

export type ConnectionHeadersResolver = (
  context: ConnectionContext
) => Record<string, string> | Promise<Record<string, string>>;

export interface McpClientConnectionDefinition {
  readonly url: string;
  readonly description: string;
  readonly transport: McpRemoteTransport;
  readonly auth?: ConnectionAuthResolver;
  readonly headers?: Record<string, string> | ConnectionHeadersResolver;
  readonly tools: { readonly allow: readonly string[] };
  readonly [MCP_CONNECTION_DEFINITION_BRAND]: true;
}

type McpClientConnectionDefinitionInput = Omit<
  McpClientConnectionDefinition,
  "transport" | typeof MCP_CONNECTION_DEFINITION_BRAND
> & {
  readonly transport?: McpRemoteTransport;
};

export function defineMcpClientConnection(
  input: McpClientConnectionDefinitionInput
): McpClientConnectionDefinition {
  if (input.tools.allow.length === 0) {
    throw new TypeError("tools.allow must contain at least one tool name");
  }
  const definition = {
    ...input,
    transport: input.transport ?? "streamableHttp",
  } as McpClientConnectionDefinition;
  return Object.defineProperty(definition, MCP_CONNECTION_DEFINITION_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function isMcpClientConnectionDefinition(
  value: unknown
): value is McpClientConnectionDefinition {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<McpClientConnectionDefinition>)[
        MCP_CONNECTION_DEFINITION_BRAND
      ] === true
  );
}
