export type RuntimeId = "local";

export interface RuntimeScopedParams {
  runtimeId?: RuntimeId;
}

export interface RuntimeView {
  id: RuntimeId;
  kind: "local";
  name: string;
  status: "connected" | "connecting" | "disconnected" | "error";
  capabilities: string[];
}
