export interface AgentPrincipal {
  readonly issuer: string;
  readonly principalId: string;
  readonly principalType: "runtime" | "service" | "user";
}

export interface AgentTenantContext {
  readonly issuer: string;
  readonly tenantId: string;
}

export interface AgentChannelContext {
  readonly id?: string;
  readonly kind: string;
}

export interface AgentTurnContext {
  readonly id: string;
  readonly sequence: number;
}

/**
 * Host-verified execution identity exposed to authored code. The Runtime never
 * derives this value from model input, Thread text, or tool arguments.
 */
export interface AgentSessionContext {
  readonly auth: {
    readonly current: AgentPrincipal;
    readonly initiator: AgentPrincipal;
  };
  readonly channel: AgentChannelContext;
  readonly id: string;
  readonly tenant?: AgentTenantContext;
  readonly turn: AgentTurnContext;
}
