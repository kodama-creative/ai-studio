import {
  PROTOCOL_VERSION,
  agent,
  methods,
  type AgentApp,
  type AgentContext,
  type ContentBlock,
  type Implementation,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type NewSessionRequest,
  type SessionUpdate,
} from "@agentclientprotocol/sdk/experimental/v2";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  PiCommittedChange,
  PiSessionSnapshot,
} from "@llm-space/pi-runtime";
import { z } from "zod";

import {
  LLM_SPACE_ACP_METHODS,
  createLlmSpaceAgentCapabilities,
} from "./extensions";
import {
  createPiSessionNotifications,
  createRunningStateUpdate,
  projectPiLogItems,
  projectPiSnapshotState,
} from "./pi-projector";

export interface PiAcpSnapshotRequest {
  readonly sessionId: string;
  readonly lane?: string;
  readonly afterSeq?: number;
}

export interface PiAcpMutationRequest extends PiAcpSnapshotRequest {
  /** Caller-generated identity used to deduplicate a retried transport request. */
  readonly commandId: string;
}

export interface PiAcpStepRequest extends PiAcpMutationRequest {
  readonly expectedActionId: string;
  readonly kind: "model" | "tool";
}

export type PiAcpContinueRequest = PiAcpMutationRequest;

export interface PiAcpDebugResponse {
  readonly fromCursor: number;
  readonly cursor: number;
  readonly snapshot: PiSessionSnapshot;
  readonly updates: readonly SessionUpdate[];
}

/**
 * Host-owned Pi session operations required by the transport-neutral ACP edge.
 * Product metadata and binding resolution remain outside this protocol package.
 */
export interface PiAcpSessionBackend {
  /** Creates one authoritative Pi Session for the ACP working directory. */
  create(request: NewSessionRequest): Promise<PiSessionSnapshot>;
  /** Lists product-owned Pi Session references using ACP pagination semantics. */
  list(request: ListSessionsRequest): Promise<ListSessionsResponse>;
  /** Reads committed log items and a current Pi debugger snapshot without effects. */
  inspect(request: PiAcpSnapshotRequest): Promise<PiCommittedChange>;
  /** Admits and automatically drives one standard ACP prompt to a terminal state. */
  prompt(input: {
    readonly sessionId: string;
    readonly messages: AgentMessage[];
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly signal: AbortSignal;
  }): Promise<PiSessionSnapshot>;
  /**
   * Releases exactly the caller-observed Pi semantic action. The host must
   * durably deduplicate commandId and reconstruct a committed lost response.
   */
  step(input: PiAcpStepRequest): Promise<PiSessionSnapshot>;
  /**
   * Drives the current Pi operation until terminal or suspended. The host must
   * durably deduplicate commandId across ACP process restarts.
   */
  continue(input: PiAcpContinueRequest): Promise<PiSessionSnapshot>;
  /** Persists user cancellation for one Pi Session. */
  abort(input: { readonly sessionId: string }): Promise<PiSessionSnapshot>;
  /** Cancels active work and releases host resources for an ACP session. */
  closeSession(input: { readonly sessionId: string }): Promise<void>;
}

export interface CreatePiAcpAgentOptions {
  readonly backend: PiAcpSessionBackend;
  readonly version: string;
  readonly name?: string;
  readonly title?: string;
  readonly now?: () => number;
}

interface CachedDebugCommand {
  readonly fingerprint: string;
  readonly response: Promise<PiAcpDebugResponse>;
}

const SNAPSHOT_REQUEST = z.object({
  sessionId: z.string().min(1),
  lane: z.string().min(1).optional(),
  afterSeq: z.number().int().nonnegative().optional(),
});
const STEP_REQUEST = SNAPSHOT_REQUEST.extend({
  commandId: z.string().min(1),
  expectedActionId: z.string().min(1),
  kind: z.enum(["model", "tool"]),
});
const CONTINUE_REQUEST = SNAPSHOT_REQUEST.extend({
  commandId: z.string().min(1),
});

/** Builds the official ACP v2 AgentApp over a host-owned Pi Session backend. */
export function createPiAcpAgent(options: CreatePiAcpAgentOptions): AgentApp {
  const now = options.now ?? Date.now;
  const activePrompts = new Map<string, AbortController>();
  const debugCommands = new Map<string, Map<string, CachedDebugCommand>>();
  const info: Implementation = {
    name: options.name ?? "llm-space",
    title: options.title ?? "LLM Space",
    version: options.version,
  };
  return agent({ name: info.name })
    .onRequest(methods.agent.initialize, ({ params }) => ({
      protocolVersion:
        params.protocolVersion === PROTOCOL_VERSION
          ? params.protocolVersion
          : PROTOCOL_VERSION,
      info,
      capabilities: createLlmSpaceAgentCapabilities(),
    }))
    .onRequest(methods.agent.session.new, async ({ params }) => {
      const snapshot = await options.backend.create(params);
      return {
        sessionId: snapshot.sessionId,
        _meta: { "llm-space.dev": { cursor: snapshot.cursor } },
      };
    })
    .onRequest(methods.agent.session.list, ({ params }) =>
      options.backend.list(params)
    )
    .onRequest(methods.agent.session.resume, async ({ params, client }) => {
      const frame = await options.backend.inspect({
        sessionId: params.sessionId,
        ...(params.replayFrom?.type === "start" ? { afterSeq: 0 } : {}),
      });
      if (params.replayFrom?.type === "start") {
        await _notifyFrame(client, frame);
      }
      return { _meta: { "llm-space.dev": { cursor: frame.cursor } } };
    })
    .onRequest(methods.agent.session.close, async ({ params }) => {
      activePrompts
        .get(params.sessionId)
        ?.abort(new Error("The ACP session was closed."));
      await options.backend.closeSession({ sessionId: params.sessionId });
      debugCommands.delete(params.sessionId);
      return {};
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      if (activePrompts.has(params.sessionId)) {
        throw new Error(`Session "${params.sessionId}" is already running.`);
      }
      const before = await options.backend.inspect({
        sessionId: params.sessionId,
      });
      const controller = new AbortController();
      activePrompts.set(params.sessionId, controller);
      await _notifyRunning(client, params.sessionId, before.cursor);
      void _drivePrompt({
        backend: options.backend,
        client,
        sessionId: params.sessionId,
        afterSeq: before.cursor,
        messages: _promptMessages(params.prompt, now()),
        ...(params._meta === undefined || params._meta === null
          ? {}
          : { meta: params._meta }),
        signal: controller.signal,
      })
        .catch(() => undefined)
        .finally(() => {
          if (activePrompts.get(params.sessionId) === controller) {
            activePrompts.delete(params.sessionId);
          }
        });
      return { _meta: { "llm-space.dev": { accepted: true } } };
    })
    .onNotification(
      methods.agent.session.cancel,
      async ({ params, client }) => {
        activePrompts
          .get(params.sessionId)
          ?.abort(new Error("The ACP prompt was cancelled."));
        const before = await options.backend.inspect({
          sessionId: params.sessionId,
        });
        await options.backend.abort({ sessionId: params.sessionId });
        await _notifyFrame(
          client,
          await options.backend.inspect({
            sessionId: params.sessionId,
            afterSeq: before.cursor,
          })
        );
      }
    )
    .onRequest(
      LLM_SPACE_ACP_METHODS.snapshot,
      SNAPSHOT_REQUEST,
      async ({ params }) =>
        _debugResponse(await options.backend.inspect(params))
    )
    .onRequest(LLM_SPACE_ACP_METHODS.step, STEP_REQUEST, ({ params, client }) =>
      _runDebugCommand(
        debugCommands,
        LLM_SPACE_ACP_METHODS.step,
        params,
        async () => {
          await _notifyRunning(client, params.sessionId, params.afterSeq ?? 0);
          await options.backend.step(params);
          const frame = await options.backend.inspect(params);
          await _notifyFrame(client, frame);
          return _debugResponse(frame);
        }
      )
    )
    .onRequest(
      LLM_SPACE_ACP_METHODS.continue,
      CONTINUE_REQUEST,
      ({ params, client }) =>
        _runDebugCommand(
          debugCommands,
          LLM_SPACE_ACP_METHODS.continue,
          params,
          async () => {
            await _notifyRunning(
              client,
              params.sessionId,
              params.afterSeq ?? 0
            );
            await options.backend.continue(params);
            const frame = await options.backend.inspect(params);
            await _notifyFrame(client, frame);
            return _debugResponse(frame);
          }
        )
    );
}

/**
 * Coalesces only concurrent transport retries. Completed responses come from
 * the backend's durable Pi reconciliation, avoiding an unbounded transcript cache.
 */
async function _runDebugCommand(
  cache: Map<string, Map<string, CachedDebugCommand>>,
  method: string,
  input: PiAcpMutationRequest,
  execute: () => Promise<PiAcpDebugResponse>
): Promise<PiAcpDebugResponse> {
  const fingerprint = JSON.stringify({ method, input });
  let sessionCommands = cache.get(input.sessionId);
  const existing = sessionCommands?.get(input.commandId);
  if (existing !== undefined) {
    if (existing.fingerprint !== fingerprint) {
      throw new Error(
        `Command "${input.commandId}" was already used with other input.`
      );
    }
    return existing.response;
  }
  const response = execute();
  if (sessionCommands === undefined) {
    sessionCommands = new Map();
    cache.set(input.sessionId, sessionCommands);
  }
  sessionCommands.set(input.commandId, { fingerprint, response });
  try {
    return await response;
  } finally {
    if (sessionCommands.get(input.commandId)?.response === response) {
      sessionCommands.delete(input.commandId);
      if (sessionCommands.size === 0) cache.delete(input.sessionId);
    }
  }
}

/** Runs accepted prompt work and always reports a final reconstructible state. */
async function _drivePrompt(input: {
  readonly backend: PiAcpSessionBackend;
  readonly client: AgentContext;
  readonly sessionId: string;
  readonly afterSeq: number;
  readonly messages: AgentMessage[];
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}): Promise<void> {
  try {
    await input.backend.prompt({
      sessionId: input.sessionId,
      messages: input.messages,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
      signal: input.signal,
    });
    await _notifyFrame(
      input.client,
      await input.backend.inspect({
        sessionId: input.sessionId,
        afterSeq: input.afterSeq,
      })
    );
  } catch (error) {
    // Cancel/close owns the final durable notification after backend abort.
    if (input.signal.aborted) return;
    try {
      await input.client.notify(methods.client.session.update, {
        sessionId: input.sessionId,
        update: {
          sessionUpdate: "state_update",
          state: "idle",
          stopReason: "error",
          _meta: {
            "llm-space.dev": {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            },
          },
        },
        _meta: { "llm-space.dev": { cursor: input.afterSeq } },
      });
    } catch {
      // A disconnected observer must not become an unhandled execution error.
    }
  }
}

/** Sends one transient running notification before a debugger command executes. */
async function _notifyRunning(
  client: AgentContext,
  sessionId: string,
  cursor: number
): Promise<void> {
  try {
    await client.notify(methods.client.session.update, {
      sessionId,
      update: createRunningStateUpdate(),
      _meta: { "llm-space.dev": { cursor } },
    });
  } catch {
    // Delivery is advisory; reconnect reads the same state from Pi durability.
  }
}

/** Projects one committed Pi frame and sends notifications in durable order. */
async function _notifyFrame(
  client: AgentContext,
  frame: PiCommittedChange
): Promise<void> {
  for (const notification of createPiSessionNotifications(
    frame.snapshot.sessionId,
    frame.fromCursor,
    frame.cursor,
    _frameUpdates(frame)
  )) {
    try {
      await client.notify(methods.client.session.update, notification);
    } catch {
      // Stop this frame; reconnect resumes from the last delivered Pi cursor.
      break;
    }
  }
}

/** Creates the response used by all incremental durable debugger requests. */
function _debugResponse(frame: PiCommittedChange): PiAcpDebugResponse {
  return {
    fromCursor: frame.fromCursor,
    cursor: frame.cursor,
    snapshot: frame.snapshot,
    updates: _frameUpdates(frame),
  };
}

/** Appends authoritative Pi state after replay-safe entry/record upserts. */
function _frameUpdates(frame: PiCommittedChange): SessionUpdate[] {
  return [
    ...projectPiLogItems(frame.items),
    projectPiSnapshotState(frame.snapshot),
  ];
}

/** Converts ACP baseline content into one Pi user message without ACP persistence. */
function _promptMessages(
  prompt: readonly ContentBlock[],
  timestamp: number
): AgentMessage[] {
  const content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[] = [];
  for (const block of prompt) {
    if (block.type === "text" && "text" in block) {
      content.push({ type: "text", text: String(block.text) });
      continue;
    }
    if (block.type === "image" && "data" in block && "mimeType" in block) {
      content.push({
        type: "image",
        data: String(block.data),
        mimeType: String(block.mimeType),
      });
      continue;
    }
    if (block.type === "resource_link" && "uri" in block) {
      const name = "name" in block ? String(block.name) : "Resource";
      content.push({ type: "text", text: `${name}: ${String(block.uri)}` });
      continue;
    }
    if (block.type === "resource" && "resource" in block) {
      const resource = block.resource;
      if (
        typeof resource === "object" &&
        resource !== null &&
        "text" in resource
      ) {
        content.push({ type: "text", text: String(resource.text) });
        continue;
      }
    }
    throw new TypeError(`Unsupported ACP prompt content type "${block.type}".`);
  }
  const onlyText = content.every((block) => block.type === "text");
  return [
    {
      role: "user",
      content: onlyText
        ? content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n")
        : content,
      timestamp,
    },
  ];
}
