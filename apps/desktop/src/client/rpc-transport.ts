import type { AgentTransport } from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { agentExecutionClient } from "./runtime-rpc-clients";

/**
 * An {@link AgentTransport} backed by Electrobun RPC. It sends the prepared
 * request as a `sendStreamThreadRequest` message and bridges the incoming
 * `receiveStreamThreadResponse` messages into an async iterator of events.
 */
export function createRpcTransport(runtimeId?: RuntimeId): AgentTransport {
  return (request, { signal, connection }) =>
    agentExecutionClient.stream(runtimeId, request, { signal, connection });
}
