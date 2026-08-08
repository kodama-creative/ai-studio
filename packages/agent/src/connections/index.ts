export {
  type AuthorizationDefinition,
  type ConnectionAuthDefinition,
  type ConnectionAuthProvider,
  type HeadersDefinition,
  type TokenResult,
  type ToolFilterDefinition,
  defineInteractiveAuthorization,
} from "./authorization";
export {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  isConnectionAuthorizationFailedError,
  isConnectionAuthorizationRequiredError,
} from "./errors";
export {
  type McpClientConnectionDefinition,
  defineMcpClientConnection,
} from "./mcp";
export {
  type OpenAPIConnectionDefinition,
  type OpenAPISpecSource,
  defineOpenAPIConnection,
} from "./openapi";
export type { JsonValue } from "../shared/types";
