import type { MaybePromise } from "../shared/types";

export interface TokenResult {
  readonly token: string;
  readonly expiresAt?: number;
}

export interface AuthorizationDefinition {
  getToken(): MaybePromise<TokenResult>;
}

export type ConnectionAuthDefinition = AuthorizationDefinition;
export type ConnectionAuthProvider = AuthorizationDefinition;
export type HeadersDefinition =
  | Readonly<
      Record<
        string,
        | string
        | Promise<string>
        | ((context: unknown) => string | Promise<string>)
      >
    >
  | (() => MaybePromise<Readonly<Record<string, string>>>);
export type ToolFilterDefinition =
  { readonly allow: readonly string[] } | { readonly block: readonly string[] };

export function defineInteractiveAuthorization<
  TDefinition extends AuthorizationDefinition,
>(definition: TDefinition): TDefinition {
  return definition;
}
