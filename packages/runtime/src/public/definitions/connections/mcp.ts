import { defineMcpClientConnectionRuntime } from "../../../internal/authored-action-definitions";

const MCP_CONNECTION_DEFINITION_BRAND = Symbol.for(
  "llm-space.mcp-connection-definition"
);

export type McpRemoteTransport = "streamableHttp";

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
  | Promise<ConnectionToken | undefined>
  | undefined;

export type ConnectionHeadersResolver = (
  context: ConnectionContext
) => Promise<Record<string, string>> | Record<string, string>;

export interface McpClientConnectionDefinition {
  readonly url: string;
  readonly description: string;
  readonly transport: McpRemoteTransport;
  readonly auth?: ConnectionAuthResolver;
  readonly headers?: ConnectionHeadersResolver | Record<string, string>;
  readonly tools: { readonly allow: readonly string[]; };
  readonly [MCP_CONNECTION_DEFINITION_BRAND]: true;
}

type McpClientConnectionDefinitionInput = {
  readonly transport?: McpRemoteTransport;
} & Omit<
  McpClientConnectionDefinition,
  "transport" | typeof MCP_CONNECTION_DEFINITION_BRAND
>;

export function defineMcpClientConnection(
  input: McpClientConnectionDefinitionInput
): McpClientConnectionDefinition {
  return defineMcpClientConnectionRuntime(
    input
  ) as McpClientConnectionDefinition;
}

export function isMcpClientConnectionDefinition(
  value: unknown
): value is McpClientConnectionDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Partial<McpClientConnectionDefinition>)[
      MCP_CONNECTION_DEFINITION_BRAND
    ] === true
  );
}
