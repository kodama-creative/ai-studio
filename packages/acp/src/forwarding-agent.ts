import {
  agent,
  methods,
  type AgentApp,
  type ClientConnection,
  type InitializeResponse,
} from "@agentclientprotocol/sdk/experimental/v2";

import { LLM_SPACE_ACP_METHODS } from "./extensions";
import {
  PI_ACP_CONTINUE_REQUEST_SCHEMA,
  PI_ACP_SNAPSHOT_REQUEST_SCHEMA,
  PI_ACP_STEP_REQUEST_SCHEMA,
  type PiAcpContinueRequest,
  type PiAcpDebugResponse,
  type PiAcpSnapshotRequest,
  type PiAcpStepRequest,
} from "./pi-agent-app";

export interface CreateForwardingAcpAgentOptions {
  readonly remote: ClientConnection;
  readonly initialization: InitializeResponse;
}

/** Presents one initialized remote Pi Agent as a local ACP AgentApp. */
export function createForwardingAcpAgent(
  options: CreateForwardingAcpAgentOptions
): AgentApp {
  const remote = options.remote.agent;
  return agent({ name: "llm-space-acp-forwarder" })
    .onRequest(methods.agent.initialize, () =>
      structuredClone(options.initialization)
    )
    .onRequest(methods.agent.session.new, ({ params }) =>
      remote.request(methods.agent.session.new, params)
    )
    .onRequest(methods.agent.session.list, ({ params }) =>
      remote.request(methods.agent.session.list, params)
    )
    .onRequest(methods.agent.session.resume, ({ params }) =>
      remote.request(methods.agent.session.resume, params)
    )
    .onRequest(methods.agent.session.close, ({ params }) =>
      remote.request(methods.agent.session.close, params)
    )
    .onRequest(methods.agent.session.prompt, ({ params }) =>
      remote.request(methods.agent.session.prompt, params)
    )
    .onNotification(methods.agent.session.cancel, ({ params }) =>
      remote.notify(methods.agent.session.cancel, params)
    )
    .onRequest<PiAcpSnapshotRequest, PiAcpDebugResponse>(
      LLM_SPACE_ACP_METHODS.snapshot,
      PI_ACP_SNAPSHOT_REQUEST_SCHEMA,
      ({ params }) =>
        remote.request<PiAcpDebugResponse, PiAcpSnapshotRequest>(
          LLM_SPACE_ACP_METHODS.snapshot,
          params
        )
    )
    .onRequest<PiAcpStepRequest, PiAcpDebugResponse>(
      LLM_SPACE_ACP_METHODS.step,
      PI_ACP_STEP_REQUEST_SCHEMA,
      ({ params }) =>
        remote.request<PiAcpDebugResponse, PiAcpStepRequest>(
          LLM_SPACE_ACP_METHODS.step,
          params
        )
    )
    .onRequest<PiAcpContinueRequest, PiAcpDebugResponse>(
      LLM_SPACE_ACP_METHODS.continue,
      PI_ACP_CONTINUE_REQUEST_SCHEMA,
      ({ params }) =>
        remote.request<PiAcpDebugResponse, PiAcpContinueRequest>(
          LLM_SPACE_ACP_METHODS.continue,
          params
        )
    );
}
