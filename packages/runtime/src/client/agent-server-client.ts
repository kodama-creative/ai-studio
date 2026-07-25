import {
  AGENT_SERVER_PROTOCOL_SCHEMA_VERSION,
  type AgentServerContinuation,
  type AgentServerRun,
  type AgentServerRuntimeWorkingBase,
  type AgentServerSession,
  type AgentServerStreamEvent,
  isRuntimeSessionBudgetWaitSnapshot,
  type JsonValue,
  type ServerRunTerminalOutcome
} from "./server-protocol";

import type { StoredRuntimeSession } from "../runtime/harness/session-store";

const DEFAULT_RETRY_CAP_MS = 5_000;
const PI_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end"
]);

export interface AgentServerClientOptions {
  readonly authorization: (() => Promise<string> | string) | string;
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly retryCapMs?: number;
}

export interface AgentServerClient<TValue extends JsonValue = JsonValue> {
  abortRun(options: {
    readonly continuationToken: string;
    readonly runId: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<
    | {
      readonly outcome: ServerRunTerminalOutcome;
      readonly status: "terminal";
    }
    | { readonly status: "aborting"; }
  >;
  decideToolApproval(options: {
    readonly continuationToken: string;
    readonly decision: "approved" | "denied";
    readonly requestId: string;
    readonly runId: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly decision: "approved" | "denied";
    readonly requestId: string;
    readonly schemaVersion: typeof AGENT_SERVER_PROTOCOL_SCHEMA_VERSION;
    readonly status: "resuming" | "waitingForApproval";
  }>;
  decideSessionBudget(options: {
    readonly continuationToken: string;
    readonly decision: "freshWindow" | "stop";
    readonly runId: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly decision: "freshWindow" | "stop";
    readonly schemaVersion: typeof AGENT_SERVER_PROTOCOL_SCHEMA_VERSION;
    readonly session: StoredRuntimeSession;
    readonly status: "resuming" | "stopped";
  }>;
  createSession(options?: {
    readonly continuationToken?: string;
    readonly idempotencyKey?: string;
    readonly signal?: AbortSignal;
  }): Promise<AgentServerSession>;
  createRun(options: {
    readonly continuationToken: string;
    readonly idempotencyKey?: string;
    readonly outputContract?: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
    readonly text: string;
    readonly workingBase?: AgentServerRuntimeWorkingBase;
  }): Promise<AgentServerRun>;
  renameBranch(options: {
    readonly branchId: string;
    readonly continuationToken: string;
    readonly label: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<StoredRuntimeSession>;
  revokeContinuation(options: {
    readonly continuationToken: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  rotateContinuation(options: {
    readonly continuationToken: string;
    readonly idempotencyKey?: string;
    readonly nextContinuationToken?: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): Promise<AgentServerContinuation>;
  streamRun(options: {
    readonly afterSequence?: number;
    readonly continuationToken: string;
    readonly onConnectionStateChange?: (
      state: "connected" | "reconnecting"
    ) => void;
    readonly runId: string;
    readonly sessionId: string;
    readonly signal?: AbortSignal;
  }): AsyncIterable<AgentServerStreamEvent<TValue>>;
}

type CreateSessionInput = NonNullable<
  Parameters<AgentServerClient["createSession"]>[0]
>;
type CreateRunInput = Parameters<AgentServerClient["createRun"]>[0];
type StreamRunInput = Parameters<AgentServerClient["streamRun"]>[0];
type AbortRunInput = Parameters<AgentServerClient["abortRun"]>[0];
type DecideToolApprovalInput = Parameters<
  AgentServerClient["decideToolApproval"]
>[0];
type DecideSessionBudgetInput = Parameters<
  AgentServerClient["decideSessionBudget"]
>[0];
type RevokeContinuationInput = Parameters<
  AgentServerClient["revokeContinuation"]
>[0];
type RenameBranchInput = Parameters<AgentServerClient["renameBranch"]>[0];
type RotateContinuationInput = Parameters<
  AgentServerClient["rotateContinuation"]
>[0];

export class AgentServerClientError extends Error {
  readonly code: string;
  readonly lastSequence: number;
  readonly status: number;

  constructor(
    message: string,
    options: { code: string; lastSequence?: number; status: number; }
  ) {
    super(message);
    this.name = "AgentServerClientError";
    this.code = options.code;
    this.lastSequence = options.lastSequence ?? 0;
    this.status = options.status;
  }
}

export function createAgentServerClient<TValue extends JsonValue = JsonValue>(
  options: AgentServerClientOptions
): AgentServerClient<TValue> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  return Object.freeze({
    async abortRun(input: AbortRunInput) {
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/abort`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "llm-space-continuation": input.continuationToken
          }),
          signal: input.signal
        }
      );
      return _jsonResponse<
        | {
          readonly outcome: ServerRunTerminalOutcome;
          readonly status: "terminal";
        }
        | { readonly status: "aborting"; }
      >(
        response,
        false
      );
    },
    async decideToolApproval(input: DecideToolApprovalInput) {
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/approvals/${encodeURIComponent(input.requestId)}`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "content-type": "application/json",
            "llm-space-continuation": input.continuationToken
          }),
          body: JSON.stringify({ decision: input.decision }),
          signal: input.signal
        }
      );
      return _jsonResponse<{
        readonly decision: "approved" | "denied";
        readonly requestId: string;
        readonly schemaVersion: 1;
        readonly status: "resuming" | "waitingForApproval";
      }>(response, false);
    },
    async decideSessionBudget(input: DecideSessionBudgetInput) {
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/budget`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "content-type": "application/json",
            "llm-space-continuation": input.continuationToken
          }),
          body: JSON.stringify({ decision: input.decision }),
          signal: input.signal
        }
      );
      return _jsonResponse<{
        readonly decision: "freshWindow" | "stop";
        readonly schemaVersion: 1;
        readonly session: StoredRuntimeSession;
        readonly status: "resuming" | "stopped";
      }>(response, false);
    },
    async createSession(
      input: CreateSessionInput = {}
    ): Promise<AgentServerSession> {
      const continuationToken = input.continuationToken
        ?? generateContinuationToken();
      const response = await fetchImplementation(`${baseUrl}/v1/sessions`, {
        method: "POST",
        headers: await _headers(options.authorization, {
          "idempotency-key": input.idempotencyKey ?? crypto.randomUUID(),
          "llm-space-next-continuation": continuationToken
        }),
        signal: input.signal
      });
      const value = await _jsonResponse<
        Omit<AgentServerSession, "continuationToken">
      >(response);
      return { ...value, continuationToken };
    },
    async createRun(input: CreateRunInput): Promise<AgentServerRun> {
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/runs`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey ?? crypto.randomUUID(),
            "llm-space-continuation": input.continuationToken
          }),
          body: JSON.stringify({
            input: { type: "text", text: input.text },
            ...(input.workingBase ? { workingBase: input.workingBase } : {}),
            ...(input.outputContract
              ? { outputContract: input.outputContract }
              : {})
          }),
          signal: input.signal
        }
      );
      return _jsonResponse<AgentServerRun>(response);
    },
    async renameBranch(input: RenameBranchInput) {
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/branches/${encodeURIComponent(input.branchId)}`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "content-type": "application/json",
            "llm-space-continuation": input.continuationToken
          }),
          body: JSON.stringify({ label: input.label }),
          signal: input.signal
        }
      );
      return _jsonResponse<StoredRuntimeSession>(response, false);
    },
    async revokeContinuation(input: RevokeContinuationInput): Promise<void> {
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/continuation/revoke`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "llm-space-continuation": input.continuationToken
          }),
          signal: input.signal
        }
      );
      if (!response.ok) {
        throw await _clientError(response, 0);
      }
    },
    async rotateContinuation(
      input: RotateContinuationInput
    ): Promise<AgentServerContinuation> {
      const nextContinuationToken = input.nextContinuationToken
        ?? generateContinuationToken();
      const response = await fetchImplementation(
        `${baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/continuation/rotate`,
        {
          method: "POST",
          headers: await _headers(options.authorization, {
            "idempotency-key": input.idempotencyKey ?? crypto.randomUUID(),
            "llm-space-continuation": input.continuationToken,
            "llm-space-next-continuation": nextContinuationToken
          }),
          signal: input.signal
        }
      );
      const value = await _jsonResponse<
        Omit<AgentServerContinuation, "continuationToken">
      >(response);
      return { ...value, continuationToken: nextContinuationToken };
    },
    streamRun(input: StreamRunInput): AsyncIterable<
      AgentServerStreamEvent<TValue>
    > {
      return _streamRun({
        ...input,
        authorization: options.authorization,
        baseUrl,
        fetchImplementation,
        retryCapMs: options.retryCapMs ?? DEFAULT_RETRY_CAP_MS
      }) as AsyncIterable<AgentServerStreamEvent<TValue>>;
    }
  });
}

export function generateContinuationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function* _streamRun(input: {
  readonly afterSequence?: number;
  readonly authorization: AgentServerClientOptions["authorization"];
  readonly baseUrl: string;
  readonly continuationToken: string;
  readonly fetchImplementation: typeof globalThis.fetch;
  readonly onConnectionStateChange?: (
    state: "connected" | "reconnecting"
  ) => void;
  readonly retryCapMs: number;
  readonly runId: string;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}): AsyncGenerator<AgentServerStreamEvent> {
  let lastSequence = input.afterSequence ?? 0;
  let retry = 0;
  const delivered = new Map<number, string>();
  while (!input.signal?.aborted) {
    let response: Response;
    const headers = await _headers(input.authorization, {
      "llm-space-continuation": input.continuationToken,
      ...(lastSequence > 0
        ? { "last-event-id": String(lastSequence) }
        : {})
    });
    try {
      response = await input.fetchImplementation(
        `${input.baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/events`,
        {
          headers,
          signal: input.signal
        }
      );
    } catch {
      if (input.signal?.aborted) {
        return;
      }
      input.onConnectionStateChange?.("reconnecting");
      await _retryDelay(++retry, input.retryCapMs, input.signal);
      continue;
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        input.onConnectionStateChange?.("reconnecting");
        await _retryDelay(
          ++retry,
          input.retryCapMs,
          input.signal,
          _retryAfterMs(response.headers.get("retry-after"))
        );
        continue;
      }
      throw await _clientError(response, lastSequence);
    }
    input.onConnectionStateChange?.("connected");
    let retryAfterMs = 0;
    try {
      for await (const event of _parseSse(response)) {
        if (event.sequence === null) {
          retryAfterMs = Math.max(
            retryAfterMs,
            event.data.retryAfterSeconds * 1_000
          );
          yield event;
          continue;
        }
        const fingerprint = _eventFingerprint(event);
        if (event.sequence <= lastSequence) {
          if (delivered.get(event.sequence) !== fingerprint) {
            throw new AgentServerClientError(
              "Agent Server replay does not match the delivered event",
              {
                status: 0,
                code: "event_replay_mismatch",
                lastSequence
              }
            );
          }
          continue;
        }
        if (event.sequence !== lastSequence + 1) {
          throw new AgentServerClientError(
            "Agent Server event sequence has a gap",
            {
              status: 0,
              code: "event_sequence_gap",
              lastSequence
            }
          );
        }
        lastSequence = event.sequence;
        delivered.set(event.sequence, fingerprint);
        retry = 0;
        yield event;
        if (event.event === "control" && event.data.type === "runTerminal") {
          return;
        }
      }
    } catch (error) {
      if (input.signal?.aborted) {
        return;
      }
      if (error instanceof AgentServerClientError) {
        throw error;
      }
      input.onConnectionStateChange?.("reconnecting");
      await _retryDelay(
        ++retry,
        input.retryCapMs,
        input.signal,
        retryAfterMs
      );
      continue;
    }
    input.onConnectionStateChange?.("reconnecting");
    await _retryDelay(
      ++retry,
      input.retryCapMs,
      input.signal,
      retryAfterMs
    );
  }
}

async function* _parseSse(
  response: Response
): AsyncGenerator<AgentServerStreamEvent> {
  if (!response.body) {
    throw new AgentServerClientError("Agent Server returned no event body", {
      status: response.status,
      code: "missing_event_body"
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const parsed = _parseSseFrame(frame);
        if (parsed) {
          yield parsed;
        }
      }
      if (done) {
        finished = true;
        return;
      }
    }
  } finally {
    if (!finished) {
      await reader.cancel("Agent Server observation stopped").catch(() => {});
    }
    reader.releaseLock();
  }
}

function _parseSseFrame(frame: string): AgentServerStreamEvent | null {
  let id = "";
  let eventName = "";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (!eventName) {
    return null;
  }
  if (eventName !== "pi" && eventName !== "control") {
    throw new AgentServerClientError("Agent Server returned an unknown event", {
      status: 0,
      code: "unknown_event_name"
    });
  }
  let parsedData: unknown;
  try {
    parsedData = JSON.parse(data.join("\n")) as unknown;
  } catch {
    throw new AgentServerClientError("Agent Server returned invalid event data", {
      status: 0,
      code: "invalid_event_data"
    });
  }
  if (!id) {
    if (
      eventName === "control"
      && _validServerShutdown(parsedData)
    ) {
      return {
        sequence: null,
        event: "control",
        data: parsedData
      };
    }
    throw new AgentServerClientError("Agent Server event is missing an id", {
      status: 0,
      code: "missing_event_id"
    });
  }
  const sequence = Number(id);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new AgentServerClientError("Agent Server returned an invalid event id", {
      status: 0,
      code: "invalid_event_id"
    });
  }
  if (
    (eventName === "control" && !(
      _validRunTerminal(parsedData)
      || _validToolApprovalRequired(parsedData)
      || _validSessionBudgetRequired(parsedData)
    ))
    || (eventName === "pi" && !_validPiEvent(parsedData))
  ) {
    throw new AgentServerClientError("Agent Server returned invalid event data", {
      status: 0,
      code: "invalid_event_data"
    });
  }
  return {
    sequence,
    event: eventName,
    data: parsedData
  } as AgentServerStreamEvent;
}

async function _headers(
  authorization: AgentServerClientOptions["authorization"],
  headers: Record<string, string>
): Promise<Record<string, string>> {
  const token = typeof authorization === "function"
    ? await authorization()
    : authorization;
  return { ...headers, authorization: `Bearer ${token}` };
}

async function _jsonResponse<T>(
  response: Response,
  requireSchema = true
): Promise<T> {
  if (!response.ok) {
    throw await _clientError(response, 0);
  }
  const value = await response.json() as { schemaVersion?: number; } & T;
  if (
    requireSchema
    && value.schemaVersion !== AGENT_SERVER_PROTOCOL_SCHEMA_VERSION
  ) {
    throw new AgentServerClientError("Unsupported Agent Server response", {
      status: response.status,
      code: "unsupported_schema"
    });
  }
  return value;
}

async function _clientError(
  response: Response,
  lastSequence: number
): Promise<AgentServerClientError> {
  let code = "request_failed";
  try {
    const value = await response.json() as { error?: { code?: string; }; };
    code = value.error?.code ?? code;
  } catch {}
  return new AgentServerClientError(`Agent Server request failed (${code})`, {
    status: response.status,
    code,
    lastSequence
  });
}

async function _retryDelay(
  attempt: number,
  capMs: number,
  signal?: AbortSignal,
  retryAfterMs = 0
): Promise<void> {
  const maximum = Math.min(
    capMs,
    250 * (2 ** Math.min(attempt - 1, 6))
  );
  const jittered = Math.floor(maximum * (0.5 + (Math.random() * 0.5)));
  const delay = Math.min(capMs, Math.max(jittered, retryAfterMs));
  await new Promise<void>(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function _retryAfterMs(value: string | null): number {
  if (!value) {
    return 0;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function _eventFingerprint(event: AgentServerStreamEvent): string {
  return JSON.stringify({ event: event.event, data: event.data });
}

function _validServerShutdown(
  value: unknown
): value is Extract<
  AgentServerStreamEvent,
  { sequence: null; }
>["data"] {
  return _record(value)
    && value.type === "serverShutdown"
    && typeof value.retryAfterSeconds === "number"
    && Number.isFinite(value.retryAfterSeconds)
    && value.retryAfterSeconds >= 0;
}

function _validRunTerminal(
  value: unknown
): value is Extract<
  AgentServerStreamEvent,
  { event: "control"; sequence: number; }
>["data"] {
  return _record(value)
    && value.type === "runTerminal"
    && (
      value.outcome === "cancelled"
      || value.outcome === "completed"
      || value.outcome === "failed"
      || value.outcome === "outcomeUnknown"
    )
    && (value.code === undefined || typeof value.code === "string")
    && (
      value.structuredOutput === undefined
      || _validStructuredOutput(value.structuredOutput)
    );
}

function _validToolApprovalRequired(value: unknown): boolean {
  return _record(value)
    && value.type === "toolApprovalRequired"
    && Array.isArray(value.approvals)
    && value.approvals.length > 0
    && value.approvals.every(approval =>
      _record(approval)
      && typeof approval.id === "string"
      && typeof approval.toolCallId === "string"
      && typeof approval.toolName === "string"
      && (approval.scope === "call" || approval.scope === "session")
      && (approval.reason === undefined || typeof approval.reason === "string"));
}

function _validSessionBudgetRequired(value: unknown): boolean {
  return _record(value)
    && value.type === "sessionBudgetRequired"
    && isRuntimeSessionBudgetWaitSnapshot(value.budget)
    && value.budget.status === "waiting"
    && _record(value.session)
    && _record(value.session.snapshot)
    && typeof value.session.snapshot.id === "string";
}

function _validStructuredOutput(value: unknown): boolean {
  return _record(value)
    && typeof value.contract === "string"
    && value.contract.length > 0
    && typeof value.schemaFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(value.schemaFingerprint)
    && _validJson(value.value, new WeakSet());
}

function _validJson(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") { return Number.isFinite(value); }
  if (typeof value !== "object" || ancestors.has(value)) { return false; }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  ancestors.add(value);
  const valid = (Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>))
    .every(child => _validJson(child, ancestors));
  ancestors.delete(value);
  return valid;
}

function _validPiEvent(value: unknown): boolean {
  return _record(value)
    && typeof value.type === "string"
    && PI_EVENT_TYPES.has(value.type);
}

function _record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
