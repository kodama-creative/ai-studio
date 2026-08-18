import type { ContentBlock } from "@llm-space/acp/protocol";
import {
  createPiSessionNotifications,
  createRunningStateUpdate,
  projectPiEphemeralEvent,
  projectPiLogItems,
  projectPiSnapshotState,
} from "@llm-space/acp/server";
import {
  messagesFromSharedSessionUpdates,
  type MessageContent,
} from "@llm-space/core";
import type { StudioApplication } from "@llm-space/studio";

import {
  ACP_SESSION_RPC,
  type AcpActionCommand,
  type AcpSessionRequests,
  type AcpSessionRpc,
  type AcpSessionStreams,
  type AcpSessionTarget,
} from "../../shared/acp-session-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

type ExecutionApplication = Pick<
  DesktopPlaygroundApplication,
  | "openExecution"
  | "readExecution"
  | "observeExecution"
  | "run"
  | "stepRun"
  | "turnRun"
  | "continueRun"
  | "resolveToolApproval"
  | "cancelActiveRun"
>;

/** Main-window ACP edge backed by the Playground product application. */
export class PlaygroundAcpSessionRpcServer
  implements RpcServer<AcpSessionRpc>
{
  readonly namespace = ACP_SESSION_RPC;
  readonly requests: AcpSessionRequests;
  readonly streams: AcpSessionStreams;

  constructor(application: DesktopPlaygroundApplication) {
    ({ requests: this.requests, streams: this.streams } = _server(
      _playgroundId,
      application
    ));
  }
}

/** Project-window ACP edge backed by the Studio product application. */
export class StudioAcpSessionRpcServer implements RpcServer<AcpSessionRpc> {
  readonly namespace = ACP_SESSION_RPC;
  readonly requests: AcpSessionRequests;
  readonly streams: AcpSessionStreams;

  constructor(application: StudioApplication, projectId: string) {
    ({ requests: this.requests, streams: this.streams } = _server(
      (target) => _experimentId(target, projectId),
      application
    ));
  }
}

function _server(
  resolveTarget: (target: AcpSessionTarget) => string,
  application: ExecutionApplication | StudioApplication
): { readonly requests: AcpSessionRequests; readonly streams: AcpSessionStreams } {
  const requests: AcpSessionRequests = {
    async prompt(target, input) {
      const id = resolveTarget(target);
      await _assertSession(application, id, input.request.sessionId);
      await _withCancellation(
        input.signal,
        () => application.cancelActiveRun(id),
        () =>
          application.run(id, {
            messages: [
              ...messagesFromSharedSessionUpdates(input.context),
              {
                id: input.messageId,
                role: "user" as const,
                content: input.request.prompt.map(_promptContent),
              },
            ],
            mode: input.mode,
            ...(input.modelOverride === undefined
              ? {}
              : { modelOverride: input.modelOverride }),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
      );
    },
    async step(target, input) {
      const id = resolveTarget(target);
      await _action(application, id, input, "step");
    },
    async turn(target, input) {
      const id = resolveTarget(target);
      await _action(application, id, input, "turn");
    },
    async continue(target, input) {
      const id = resolveTarget(target);
      await _withCancellation(
        input.signal,
        () => application.cancelActiveRun(id),
        () =>
          application.continueRun(id, input.operationId, {
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
      );
    },
    async requestPermission(target, input) {
      const id = resolveTarget(target);
      await _withCancellation(
        input.signal,
        () => application.cancelActiveRun(id),
        async () => {
          await application.resolveToolApproval(id, input.operationId, {
            toolCallId: input.toolCallId,
            approved: input.optionId === "allow_once",
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          if (input.resumeMode === "continue") {
            await application.continueRun(id, input.operationId, {
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
          } else {
            await application.stepRun(id, input.operationId, {
              expectedActionId: input.expectedActionId,
              kind: "tool",
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
          }
        }
      );
    },
    cancel(target) {
      return application.cancelActiveRun(resolveTarget(target));
    },
  };
  const streams: AcpSessionStreams = {
    async *updates(target, input = {}) {
      const id = resolveTarget(target);
      const initial = await application.readExecution(id, input.afterCursor);
      const initialUpdates = [
        ...projectPiLogItems(initial.items),
        projectPiSnapshotState(initial.snapshot),
      ];
      yield* createPiSessionNotifications(
        initial.snapshot.sessionId,
        initial.fromCursor,
        initial.cursor,
        initialUpdates
      );
      let cursor = initial.cursor;
      for await (const event of application.observeExecution(id, {
        afterSeq: cursor,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })) {
        if (event.type === "state") {
          yield {
            sessionId: initial.snapshot.sessionId,
            update: createRunningStateUpdate(),
            _meta: { "llm-space.dev": { cursor } },
          };
          continue;
        }
        if (event.type === "ephemeral") {
          yield {
            sessionId: initial.snapshot.sessionId,
            update: projectPiEphemeralEvent(event.event),
            _meta: { "llm-space.dev": { cursor } },
          };
          continue;
        }
        const { change } = event;
        const updates = [
          ...projectPiLogItems(change.items),
          projectPiSnapshotState(change.snapshot),
        ];
        cursor = change.cursor;
        yield* createPiSessionNotifications(
          change.snapshot.sessionId,
          change.fromCursor,
          change.cursor,
          updates
        );
      }
    },
  };
  return { requests, streams };
}

function _promptContent(content: ContentBlock): MessageContent {
  const value = content as unknown as Readonly<Record<string, unknown>>;
  if (value.type === "text" && typeof value.text === "string") {
    return { type: "text", text: value.text };
  }
  if (
    value.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    return {
      type: "image",
      data: value.data,
      mimeType: value.mimeType,
    };
  }
  throw new Error("ACP Prompt contains an unsupported content block.");
}

async function _action(
  application: ExecutionApplication | StudioApplication,
  id: string,
  input: AcpActionCommand,
  mode: "step" | "turn"
): Promise<void> {
  await _withCancellation(
    input.signal,
    () => application.cancelActiveRun(id),
    () =>
      mode === "step"
        ? application.stepRun(id, input.operationId, {
            expectedActionId: input.expectedActionId,
            kind: input.kind,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
        : application.turnRun(id, input.operationId, {
            expectedActionId: input.expectedActionId,
            kind: input.kind,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
  );
}

async function _assertSession(
  application: ExecutionApplication | StudioApplication,
  id: string,
  requested: string
): Promise<void> {
  const session = await application.openExecution(id);
  if (session.sessionId !== requested) {
    throw new Error(
      `ACP Session "${requested}" does not belong to the selected product.`
    );
  }
}

function _playgroundId(target: AcpSessionTarget): string {
  if (target.kind !== "playground") {
    throw new Error("This window only executes Playground ACP Sessions.");
  }
  return target.playgroundId;
}

function _experimentId(target: AcpSessionTarget, projectId: string): string {
  if (target.kind !== "experiment") {
    throw new Error("This window only executes Studio ACP Sessions.");
  }
  if (target.projectId !== projectId) {
    throw new Error(
      `Project "${target.projectId}" is not open in this Studio window.`
    );
  }
  return target.experimentId;
}

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
