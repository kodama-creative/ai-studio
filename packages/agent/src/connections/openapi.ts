import { CONNECTION_PROTOCOL_BRAND, type JsonValue } from "../shared/types";
import type { Approval } from "../tools/approval";

import type {
  ConnectionAuthDefinition,
  HeadersDefinition,
  ToolFilterDefinition,
} from "./authorization";

export type OpenAPISpecSource = string | Readonly<Record<string, JsonValue>>;

export interface OpenAPIConnectionDefinition {
  readonly description: string;
  readonly spec: OpenAPISpecSource;
  readonly baseUrl?: string;
  readonly auth?: ConnectionAuthDefinition;
  readonly approval?: Approval;
  readonly headers?: HeadersDefinition;
  readonly toolCall?: Readonly<Record<string, unknown>>;
  readonly operations?: ToolFilterDefinition;
}

export function defineOpenAPIConnection(
  definition: OpenAPIConnectionDefinition
): OpenAPIConnectionDefinition {
  Object.defineProperty(definition, CONNECTION_PROTOCOL_BRAND, {
    value: "openapi",
  });
  return definition;
}
