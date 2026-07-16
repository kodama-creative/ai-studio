import {
  type AgentEvent,
  type AgentTransport,
  type ThreadAgentRuntimeProvenance,
  type ThreadServerRunLineage,
  uuid
} from "@llm-space/core";

import { electrobun } from "@/lib/electrobun";

import type {
  ExternalAgentProjectRuntimeStatus
} from "@/shared/external-agent-project";
import type {
  StreamThreadRequestPayload,
  StreamThreadResponsePayload
} from "@/shared/rpc";

const createAbortError = () =>
  new DOMException("The operation was aborted.", "AbortError");

/**
 * An {@link AgentTransport} backed by Electrobun RPC. It sends the prepared
 * request as a `sendStreamThreadRequest` message and bridges the incoming
 * `receiveStreamThreadResponse` messages into an async iterator of events.
 */
export function createRpcTransport(options?: {
  onLocalServerLineage?: (
    lineage: ThreadServerRunLineage,
    terminalOutcome?: "cancelled" | "completed" | "failed" | "outcomeUnknown"
  ) => void;
  onLocalServerStatus?: (status: ExternalAgentProjectRuntimeStatus) => void;
  onRuntimeResolved?: (runtime: ThreadAgentRuntimeProvenance) => void;
  runtime?: () => StreamThreadRequestPayload["runtime"];
  settleAbort?: () => boolean;
}): AgentTransport {
  return async function* rpcTransport(request, { signal }) {
    const rpc = electrobun.rpc;
    if (!rpc) {
      throw new Error("Electrobun RPC is not initialized");
    }

    const streamId = uuid();
    const events: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let aborted = false;
    let settleAbort = false;
    let errorMessage: string | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };
    const waitForEvent = async () => {
      await new Promise<void>(resolve => {
        wake = resolve;
      });
    };

    const onResponse = (message: StreamThreadResponsePayload) => {
      if (message.streamId !== streamId) {
        return;
      }
      if (message.type === "event") {
        events.push(message.event);
      } else if (message.type === "runtime") {
        options?.onRuntimeResolved?.(message.runtime);
      } else if (message.type === "localServerStatus") {
        options?.onLocalServerStatus?.(message.status);
      } else if (message.type === "localServerLineage") {
        options?.onLocalServerLineage?.(
          message.lineage,
          message.terminalOutcome
        );
        if (aborted && message.terminalOutcome) {
          finished = true;
        }
      } else if (message.type === "done") {
        finished = true;
      } else {
        errorMessage = message.message;
        finished = true;
      }
      notify();
    };

    const onAbort = () => {
      rpc.send.abortStreamThread({ streamId });
      aborted = true;
      settleAbort = options?.settleAbort?.() ?? false;
      if (!settleAbort) {
        finished = true;
      }
      notify();
    };

    if (signal?.aborted) {
      throw createAbortError();
    }

    rpc.addMessageListener("receiveStreamThreadResponse", onResponse);
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      rpc.send.sendStreamThreadRequest({
        streamId,
        request,
        ...(options?.runtime ? { runtime: options.runtime() } : {})
      });
      while (true) {
        if (aborted) {
          if (finished || !settleAbort) {
            throw createAbortError();
          }
          await waitForEvent();
          continue;
        }
        while (events.length > 0) {
          yield events.shift()!;
        }
        if (errorMessage !== null) {
          throw new Error(errorMessage);
        }
        if (finished) {
          return;
        }
        await waitForEvent();
      }
    } finally {
      rpc.removeMessageListener("receiveStreamThreadResponse", onResponse);
      signal?.removeEventListener("abort", onAbort);
      // Consumer stopped early (break / downstream error) without an abort
      // signal — make sure the bun side tears the stream down too.
      if (!finished) {
        rpc.send.abortStreamThread({ streamId });
      }
    }
  };
}
