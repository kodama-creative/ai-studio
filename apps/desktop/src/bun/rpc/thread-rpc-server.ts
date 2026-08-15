import type {
  StudioApplication,
} from "@llm-space/studio";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  THREAD_RPC,
  type ThreadRequests,
  type ThreadRpc,
  type ThreadRunInput,
  type ThreadTarget,
} from "../../shared/thread-rpc";
import type { DesktopPlaygroundApplication } from "../application/playground-application";

/** Main-window Thread commands backed by the Playground product service. */
export class PlaygroundThreadRpcServer implements RpcServer<ThreadRpc> {
  readonly namespace = THREAD_RPC;
  readonly requests: ThreadRequests;
  readonly streams = {};

  constructor(application: DesktopPlaygroundApplication) {
    this.requests = {
      run: async (target, input) =>
        application.run(_playgroundId(target), {
          fromMessageId: input.fromMessageId,
          commandId: input.commandId,
          mode: input.mode,
        }),
      inspect: async (target, operationId) => {
        return application.inspectRun(_playgroundId(target), operationId);
      },
      step: async (target, operationId, input) => {
        return application.stepRun(_playgroundId(target), operationId, input);
      },
      continue: async (target, operationId, input) => {
        return application.continueRun(
          _playgroundId(target),
          operationId,
          input
        );
      },
      resolveToolApproval: async (target, operationId, input) => {
        return application.resolveToolApproval(
          _playgroundId(target),
          operationId,
          input
        );
      },
      cancel: async (target, operationId) => {
        return application.cancelRun(_playgroundId(target), operationId);
      },
    };
  }
}

/** Project-window Thread commands backed by the Studio product service. */
export class StudioThreadRpcServer implements RpcServer<ThreadRpc> {
  readonly namespace = THREAD_RPC;
  readonly requests: ThreadRequests;
  readonly streams = {};

  constructor(application: StudioApplication, projectId: string) {
    const experimentId = (target: ThreadTarget) =>
      _experimentId(target, projectId);
    this.requests = {
      run: async (target, input) =>
        application.run(experimentId(target), _studioRunInput(input)),
      inspect: async (target, operationId) => {
        return application.inspectRun(experimentId(target), operationId);
      },
      step: async (target, operationId, input) => {
        return application.stepRun(experimentId(target), operationId, input);
      },
      continue: async (target, operationId, input) => {
        return application.continueRun(
          experimentId(target),
          operationId,
          input
        );
      },
      resolveToolApproval: async (target, operationId, input) => {
        return application.resolveToolApproval(
          experimentId(target),
          operationId,
          input
        );
      },
      cancel: async (target, operationId) => {
        return application.cancelRun(experimentId(target), operationId);
      },
    };
  }
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
    ...(input.modelOverride === undefined
      ? {}
      : { modelOverride: input.modelOverride }),
  };
}
