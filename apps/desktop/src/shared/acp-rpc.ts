import type { AnyWireMessage } from "@llm-space/acp";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RuntimeId } from "./runtime";

export type AcpConnectionTarget =
  | { readonly kind: "local" }
  | {
      readonly kind: "remote";
      readonly runtimeId: RuntimeId;
      /** Absolute path interpreted by `llm-space acp` on the remote host. */
      readonly projectRoot: string;
    };

/** Electrobun envelope carrying an otherwise unchanged ACP v2 wire stream. */
export interface AcpRpc {
  readonly requests: AcpRequests;
  readonly streams: AcpStreams;
  readonly events: Record<never, never>;
}

export interface AcpRequests {
  open(connectionId: string, target?: AcpConnectionTarget): Promise<void>;
  send(connectionId: string, message: AnyWireMessage): Promise<void>;
  close(connectionId: string): Promise<void>;
}

export interface AcpStreams {
  receive(
    connectionId: string,
    options?: { readonly signal?: AbortSignal }
  ): AsyncIterable<AnyWireMessage>;
}

export type AcpClient = AcpRequests & AcpStreams;

export const ACP_RPC = defineRpcNamespace<AcpRpc>("acp", {
  streams: ["receive"],
  events: [],
});
