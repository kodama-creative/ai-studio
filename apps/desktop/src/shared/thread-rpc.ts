import type { PiSessionSnapshot } from "@llm-space/pi-runtime";
import type {
  StudioContinueInput,
  StudioRunReceipt,
  StudioStepRunInput,
  StudioToolApprovalInput,
} from "@llm-space/studio";

import { defineRpcNamespace } from "./namespaced-rpc";

/** Product identity used by the renderer without exposing a raw Pi Session. */
export type ThreadTarget =
  | { readonly kind: "playground"; readonly playgroundId: string }
  | {
      readonly kind: "experiment";
      readonly projectId: string;
      readonly experimentId: string;
    };

export interface ThreadRunInput {
  readonly fromMessageId: string;
  readonly commandId: string;
  readonly mode: "step" | "continue";
  readonly modelOverride?: string;
}

/** UI Thread execution commands shared by Playground and Studio windows. */
export interface ThreadRpc {
  readonly requests: ThreadRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export interface ThreadRequests {
  run(
    target: ThreadTarget,
    input: ThreadRunInput
  ): Promise<StudioRunReceipt>;
  inspect(
    target: ThreadTarget,
    operationId: string
  ): Promise<PiSessionSnapshot>;
  step(
    target: ThreadTarget,
    operationId: string,
    input: StudioStepRunInput
  ): Promise<StudioRunReceipt>;
  continue(
    target: ThreadTarget,
    operationId: string,
    input: StudioContinueInput
  ): Promise<StudioRunReceipt>;
  resolveToolApproval(
    target: ThreadTarget,
    operationId: string,
    input: StudioToolApprovalInput
  ): Promise<StudioRunReceipt>;
  cancel(target: ThreadTarget, operationId: string): Promise<void>;
}

export type ThreadClient = ThreadRequests;

export const THREAD_RPC = defineRpcNamespace<ThreadRpc>("thread", {
  requests: {
    run: true,
    inspect: true,
    step: true,
    continue: true,
    resolveToolApproval: true,
    cancel: true,
  },
  streams: {},
  events: {},
});
