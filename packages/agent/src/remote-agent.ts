import type { SchemaSource } from "./shared/types";

export type RemoteAgentUrl = string | (() => string | Promise<string>);

export interface RemoteAgentDefinition {
  readonly auth?: unknown;
  readonly description: string;
  readonly forwardPrincipal?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly kind: "remote";
  readonly outputSchema?: SchemaSource;
  readonly path: string;
  readonly url: RemoteAgentUrl;
}

export type RemoteAgentDefinitionInput = Omit<
  RemoteAgentDefinition,
  "kind" | "path"
> & { readonly path?: string };

export function defineRemoteAgent(
  input: RemoteAgentDefinitionInput
): RemoteAgentDefinition {
  return {
    ...input,
    kind: "remote",
    path: input.path ?? "/llm-space/v1/session",
  };
}
