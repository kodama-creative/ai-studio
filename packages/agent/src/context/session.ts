export interface SessionAuthContext {
  readonly id?: string;
  readonly [key: string]: unknown;
}

export interface SessionAuth {
  readonly current: SessionAuthContext | null;
  readonly initiator: SessionAuthContext | null;
}

export interface SessionParent {
  readonly agentId?: string;
  readonly sessionId: string;
}

export interface SessionTurn {
  readonly id: string;
  readonly sequence: number;
}

export interface Session {
  readonly id: string;
  readonly auth: SessionAuth;
  readonly parent?: SessionParent;
  readonly turn?: SessionTurn;
}
