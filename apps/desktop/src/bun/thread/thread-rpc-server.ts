import type { StudioApplication } from "@llm-space/studio";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  THREAD_RPC,
  type ThreadRequests,
  type ThreadRpc,
  type ThreadRunInput,
  type ThreadTarget,
} from "../../shared/thread-rpc";
import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

/** Main-window Thread commands backed by the Playground product service. */
export class PlaygroundThreadRpcServer implements RpcServer<ThreadRpc> {
  readonly namespace = THREAD_RPC;
  readonly requests: ThreadRequests;
  readonly streams = {};

  constructor(application: DesktopPlaygroundApplication) {
    this.requests = _threadRequests(_playgroundId, {
      run: (playgroundId, input) =>
        application.run(playgroundId, {
          fromMessageId: input.fromMessageId,
          commandId: input.commandId,
          mode: input.mode,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      inspect: (playgroundId, operationId) =>
        application.inspectRun(playgroundId, operationId),
      step: (playgroundId, operationId, input) =>
        application.stepRun(playgroundId, operationId, input),
      continue: (playgroundId, operationId, input) =>
        application.continueRun(playgroundId, operationId, input),
      resolveToolApproval: (playgroundId, operationId, input) =>
        application.resolveToolApproval(playgroundId, operationId, input),
      cancel: (playgroundId) => application.cancelActiveRun(playgroundId),
    });
  }
}

/** Project-window Thread commands backed by the Studio product service. */
export class StudioThreadRpcServer implements RpcServer<ThreadRpc> {
  readonly namespace = THREAD_RPC;
  readonly requests: ThreadRequests;
  readonly streams = {};

  constructor(application: StudioApplication, projectId: string) {
    this.requests = _threadRequests(
      (target) => _experimentId(target, projectId),
      {
        run: (threadId, input) =>
          application.run(threadId, _studioRunInput(input)),
        inspect: (threadId, operationId) =>
          application.inspectRun(threadId, operationId),
        step: (threadId, operationId, input) =>
          application.stepRun(threadId, operationId, input),
        continue: (threadId, operationId, input) =>
          application.continueRun(threadId, operationId, input),
        resolveToolApproval: (threadId, operationId, input) =>
          application.resolveToolApproval(threadId, operationId, input),
        cancel: (threadId) => application.cancelActiveRun(threadId),
      }
    );
  }
}

interface ThreadOperations {
  run(
    id: string,
    input: Parameters<ThreadRequests["run"]>[1]
  ): ReturnType<ThreadRequests["run"]>;
  inspect(
    id: string,
    operationId: string
  ): ReturnType<ThreadRequests["inspect"]>;
  step(
    id: string,
    operationId: string,
    input: Parameters<ThreadRequests["step"]>[2]
  ): ReturnType<ThreadRequests["step"]>;
  continue(
    id: string,
    operationId: string,
    input: Parameters<ThreadRequests["continue"]>[2]
  ): ReturnType<ThreadRequests["continue"]>;
  resolveToolApproval(
    id: string,
    operationId: string,
    input: Parameters<ThreadRequests["resolveToolApproval"]>[2]
  ): ReturnType<ThreadRequests["resolveToolApproval"]>;
  cancel(id: string): Promise<void>;
}

/** Applies target resolution and request-local cancellation for both Thread products. */
function _threadRequests(
  resolveTarget: (target: ThreadTarget) => string,
  operations: ThreadOperations
): ThreadRequests {
  return {
    async run(target, input) {
      const id = resolveTarget(target);
      return _withCancellation(
        input.signal,
        () => operations.cancel(id),
        () => operations.run(id, input)
      );
    },
    async inspect(target, operationId) {
      return operations.inspect(resolveTarget(target), operationId);
    },
    async step(target, operationId, input) {
      const id = resolveTarget(target);
      return _withCancellation(
        input.signal,
        () => operations.cancel(id),
        () => operations.step(id, operationId, input)
      );
    },
    async continue(target, operationId, input) {
      const id = resolveTarget(target);
      return _withCancellation(
        input.signal,
        () => operations.cancel(id),
        () => operations.continue(id, operationId, input)
      );
    },
    async resolveToolApproval(target, operationId, input) {
      const id = resolveTarget(target);
      return _withCancellation(
        input.signal,
        () => operations.cancel(id),
        () => operations.resolveToolApproval(id, operationId, input)
      );
    },
    async cancel(target) {
      return operations.cancel(resolveTarget(target));
    },
  };
}

function _playgroundId(target: ThreadTarget): string {
  if (target.kind !== "playground") {
    throw new Error("This window only executes Playground Threads.");
  }
  return target.playgroundId;
}

function _experimentId(target: ThreadTarget, projectId: string): string {
  if (target.kind !== "experiment") {
    throw new Error("This window only executes Studio Experiment Threads.");
  }
  if (target.projectId !== projectId) {
    throw new Error(
      `Project "${target.projectId}" is not open in this Studio window.`
    );
  }
  return target.experimentId;
}

function _studioRunInput(input: ThreadRunInput) {
  return {
    fromMessageId: input.fromMessageId,
    commandId: input.commandId,
    mode: input.mode,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.modelOverride === undefined
      ? {}
      : { modelOverride: input.modelOverride }),
  };
}

/** Couples one request-local transport signal to the product's active Pi operation. */
async function _withCancellation<T>(
  signal: AbortSignal | undefined,
  cancel: () => Promise<void>,
  execute: () => Promise<T>
): Promise<T> {
  if (signal === undefined) return execute();
  let cancellation: Promise<void> | undefined;
  const onAbort = () => {
    cancellation ??= cancel();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    return await execute();
  } finally {
    signal.removeEventListener("abort", onAbort);
    await cancellation;
  }
}
