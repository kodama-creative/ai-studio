import { createHash, timingSafeEqual } from "node:crypto";

export interface ServerPrincipal {
  readonly issuer: string;
  readonly principalId: string;
  readonly principalType: "service" | "user";
  readonly tenant?: {
    readonly issuer: string;
    readonly tenantId: string;
  };
}

export interface ServerAuthenticator {
  authenticate(request: Request): Promise<ServerPrincipal | null>;
}

export interface StaticBearerPrincipal extends ServerPrincipal {
  readonly token: string;
}

export function createStaticBearerAuthenticator(
  principals: readonly StaticBearerPrincipal[]
): ServerAuthenticator {
  const identities = new Map<string, ServerPrincipal>();
  for (const configured of principals) {
    const { token } = configured;
    const principal: ServerPrincipal = {
      issuer: configured.issuer,
      principalId: configured.principalId,
      principalType: configured.principalType,
      ...(configured.tenant ? { tenant: { ...configured.tenant } } : {})
    };
    if (
      typeof principal.issuer !== "string"
      || principal.issuer.length === 0
      || principal.issuer.length > 256
      || typeof principal.principalId !== "string"
      || principal.principalId.length === 0
      || principal.principalId.length > 256
      || (principal.principalType !== "service"
        && principal.principalType !== "user")
      || (principal.tenant !== undefined && (
        typeof principal.tenant.issuer !== "string"
        || principal.tenant.issuer.length === 0
        || principal.tenant.issuer.length > 256
        || typeof principal.tenant.tenantId !== "string"
        || principal.tenant.tenantId.length === 0
        || principal.tenant.tenantId.length > 256
      ))
    ) {
      throw new TypeError("Static Bearer principals must have a valid identity");
    }
    if (
      typeof token !== "string"
      || new TextEncoder().encode(token).byteLength < 32
    ) {
      throw new TypeError("Static Bearer tokens must contain at least 32 bytes");
    }
    const fingerprint = _tokenFingerprint(token);
    if (identities.has(fingerprint)) {
      throw new TypeError("Static Bearer tokens must be unique");
    }
    identities.set(fingerprint, Object.freeze(principal));
  }
  if (identities.size === 0) {
    throw new TypeError("At least one static Bearer principal is required");
  }
  return Object.freeze({
    async authenticate(request: Request): Promise<ServerPrincipal | null> {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) {
        return null;
      }
      const presented = _tokenFingerprint(authorization.slice(7));
      for (const [expected, principal] of identities) {
        if (
          timingSafeEqual(Buffer.from(presented, "hex"), Buffer.from(expected, "hex"))
        ) {
          return principal;
        }
      }
      return null;
    }
  });
}

function _tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
