import type { AgentEvent } from "@earendil-works/pi-agent-core";

import { convertToPiContext } from "./converters";
import {
  isRunnableConversation,
  RUN_LAST_MESSAGE_ERROR
} from "./run-eligibility";
import { type AgentTransport, createHttpTransport } from "./transport";

import type { AgentStreamRequest } from "../types/agent";
import type { ModelConfig } from "../types/models";
import type {
  ThreadContext,
  ThreadSandboxAttachments
} from "../types/threads";

export async function* streamThread(
  args: {
    context: ThreadContext;
    model: ModelConfig;
    outputContract?: string;
    sandboxAttachments?: ThreadSandboxAttachments;
  },
  config: {
    endpoint?: string;
    signal?: AbortSignal;
    transport?: AgentTransport;
  } = {}
): AsyncGenerator<AgentEvent> {
  if (!isRunnableConversation(args.context.messages)) {
    throw new Error(RUN_LAST_MESSAGE_ERROR);
  }
  const context = convertToPiContext(
    args.context,
    args.sandboxAttachments
  );
  const request: AgentStreamRequest = {
    model: {
      provider: args.model.provider,
      id: args.model.id
    },
    config: {
      model: args.model.params
    },
    context,
    ...(args.outputContract ? { outputContract: args.outputContract } : {})
  };
  // Transport is the only HTTP-vs-RPC-specific piece; default to HTTP/SSE.
  const transport = config.transport ?? createHttpTransport(config.endpoint);
  yield* transport(request, { signal: config.signal });
}
