import { CONNECTION_PROTOCOL_BRAND } from "../shared/types";
import type { Approval } from "../tools/approval";

import type {
  ConnectionAuthDefinition,
  HeadersDefinition,
  ToolFilterDefinition,
} from "./authorization";

export interface McpClientConnectionDefinition {
  readonly description: string;
  readonly url: string;
  readonly auth?: ConnectionAuthDefinition;
  readonly approval?: Approval;
  readonly headers?: HeadersDefinition;
  readonly toolCall?: Readonly<Record<string, unknown>>;
  readonly tools?: ToolFilterDefinition;
}

export function defineMcpClientConnection(
  definition: McpClientConnectionDefinition
): McpClientConnectionDefinition {
  Object.defineProperty(definition, CONNECTION_PROTOCOL_BRAND, {
    value: "mcp",
  });
  return definition;
}
