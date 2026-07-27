import {
  decideRuntimeSessionBudget,
  decideRuntimeToolApproval,
  MAX_RUNTIME_BRANCH_LABEL_LENGTH,
  recoverRuntimeSession
} from "@llm-space/runtime/harness";

import type { Models } from "@earendil-works/pi-ai";
import type { RuntimeWorkingBase } from "@llm-space/runtime/harness";
import type {
  AgentHostApprovalPolicy,
  CompiledAgentProjectSnapshot,
  SandboxProvider
} from "@llm-space/runtime/server";

import {
  assertValidTrustedProxyRanges,
  isTrustedProxyAddress
} from "../network/trusted-proxy";
import {
  type ObservedServerEvent,
  ServerCursorError,
  ServerHiddenSessionError,
  ServerIdempotencyConflictError,
  ServerRunConflictError,
  ServerSessionRepository
} from "../repository/server-session-repository";
import {
  ServerCapacityError,
  ServerRunController
} from "../runtime/server-run-controller";

import type {
  ServerAuthenticator,
  ServerPrincipal
} from "../auth/server-authenticator";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_TEXT_INPUT_BYTES = 32 * 1024;

export interface StartAgentServerOptions {
  readonly approvalPolicy?: AgentHostApprovalPolicy;
  readonly artifactFingerprint: string;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly authenticator: ServerAuthenticator;
  readonly continuationTtlSeconds?: number;
  readonly hostname?: string;
  readonly localDev?: boolean;
  readonly maxActiveRuns?: number;
  readonly maxStructuredOutputBytes?: number;
  readonly models: Models;
  readonly port?: number;
  readonly project: CompiledAgentProjectSnapshot;
  readonly repositoryRoot: string;
  readonly shutdownTimeoutSeconds?: number;
  readonly sandboxProvider?: SandboxProvider;
  readonly tls?: Bun.TLSOptions;
  readonly trustedProxyCidrs?: readonly string[];
}

export interface StartedAgentServer {
  readonly url: string;
  stop(): Promise<void>;
}

interface RequestContext {
  accepting: boolean;
  readonly allowedHosts: Set<string>;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly authenticator: ServerAuthenticator;
  readonly repository: ServerSessionRepository;
  readonly runs: ServerRunController;
  readonly trustedProxyCidrs: readonly string[];
}

export async function startAgentServer(
  options: StartAgentServerOptions
): Promise<StartedAgentServer> {
  if (options.project.artifact.fingerprint !== options.artifactFingerprint) {
    throw new Error("Server artifact fingerprint does not match its project");
  }
  const hostname = options.hostname ?? "127.0.0.1";
  const loopback = _isLoopbackHost(hostname);
  if (options.localDev && !loopback) {
    throw new Error("Local-dev Agent Server must bind to a loopback host");
  }
  if (!options.localDev && !options.tls && !options.trustedProxyCidrs?.length) {
    throw new Error(
      "Agent Server requires local-dev loopback, Bun TLS, or a trusted TLS terminator"
    );
  }
  const allowedHosts = new Set(
    (options.allowedHosts ?? []).map(_normalizeAllowedHost)
  );
  if (
    options.trustedProxyCidrs?.length
    && ![...allowedHosts].some(_isPublicAllowedHost)
  ) {
    throw new Error("Trusted TLS terminator mode requires an allowed public Host");
  }
  const shutdownTimeoutSeconds = options.shutdownTimeoutSeconds ?? 30;
  _assertIntegerOption(
    shutdownTimeoutSeconds,
    1,
    300,
    "shutdownTimeoutSeconds"
  );
  assertValidTrustedProxyRanges(options.trustedProxyCidrs ?? []);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    const localHttp = options.localDev
      && parsed.protocol === "http:"
      && _isLoopbackHost(parsed.hostname);
    if (
      parsed.origin !== origin
      || (parsed.protocol !== "https:" && !localHttp)
    ) {
      throw new TypeError(
        "CORS origins must be exact HTTPS origins or local-dev loopback HTTP origins"
      );
    }
  }
  const definition = options.project.definition;
  const model = definition
    ? options.models.getModel(
      definition.model.provider,
      definition.model.id
    )
    : undefined;
  if (!model) {
    throw new Error("Compiled Agent default model is unavailable");
  }
  if (!await options.models.getAuth(model)) {
    throw new Error("Compiled Agent default model is not configured");
  }
  const repository = await ServerSessionRepository.open({
    root: options.repositoryRoot,
    artifactFingerprint: options.artifactFingerprint,
    continuationTtlSeconds: options.continuationTtlSeconds
  });
  try {
    const recoverableRuns = [];
    for (const sessionId of repository.sessionIds()) {
      const recovery = await recoverRuntimeSession(repository, sessionId);
      if (recovery.status === "outcomeUnknown") {
        await repository.completeRun({
          sessionId,
          runId: recovery.run.id,
          outcome: "outcomeUnknown",
          code: "process_interrupted"
        });
      } else if (recovery.status === "cancelled") {
        await repository.completeRun({
          sessionId,
          runId: recovery.run.id,
          outcome: "cancelled"
        });
      } else if (recovery.status === "operationReplay") {
        recoverableRuns.push(repository.recoverableRun(
          sessionId,
          recovery.run.id
        ));
      }
      for (const terminal of repository.pendingRuntimeTerminals(sessionId)) {
        await repository.completeRun({
          sessionId,
          runId: terminal.runId,
          outcome: terminal.outcome,
          ...(terminal.code ? { code: terminal.code } : {})
        });
      }
    }
    const runs = new ServerRunController({
      repository,
      models: options.models,
      project: options.project,
      ...(options.approvalPolicy
        ? { approvalPolicy: options.approvalPolicy }
        : {}),
      maxActiveRuns: options.maxActiveRuns,
      maxStructuredOutputBytes: options.maxStructuredOutputBytes,
      ...(options.sandboxProvider
        ? { sandboxProvider: options.sandboxProvider }
        : {})
    });
    for (const run of recoverableRuns) {
      runs.resumeRun(run);
    }
    const context: RequestContext = {
      accepting: true,
      allowedHosts,
      allowedOrigins,
      authenticator: options.authenticator,
      repository,
      runs,
      trustedProxyCidrs: [...(options.trustedProxyCidrs ?? [])]
    };
    const server = Bun.serve({
      hostname,
      port: options.port ?? 0,
      ...(options.tls ? { tls: options.tls } : {}),
      fetch: async (request, bunServer) => {
        let response: Response;
        try {
          response = await _handleRequest(
            request,
            context,
            bunServer.requestIP(request)?.address
          );
        } catch (error) {
          response = error instanceof URIError
            ? _error(400, "invalid_request")
            : _error(500, "internal_error");
        }
        return _varyOrigin(response);
      }
    });
    if (context.trustedProxyCidrs.length === 0) {
      context.allowedHosts.add(`${server.hostname}:${server.port}`);
    }
    if (
      context.trustedProxyCidrs.length === 0
      && _isLoopbackHost(server.hostname)
    ) {
      context.allowedHosts.add(`localhost:${server.port}`);
    }
    let stopped = false;
    return Object.freeze({
      url: `${options.tls ? "https" : "http"}://${server.hostname}:${server.port}`,
      async stop(): Promise<void> {
        if (stopped) {
          return;
        }
        stopped = true;
        context.accepting = false;
        repository.notifyShutdown(1);
        runs.abortAll();
        const drained = await _waitForIdle(runs, shutdownTimeoutSeconds);
        if (!drained) {
          runs.detach();
        }
        try {
          await server.stop(true);
        } finally {
          const sandboxProvider = options.sandboxProvider;
          if (sandboxProvider) {
            await Promise.allSettled(
              repository.sessionIds().map(async sessionId =>
                sandboxProvider.stop(sessionId))
            );
          }
          await repository.close();
        }
      }
    });
  } catch (error) {
    await repository.close();
    throw error;
  }
}

async function _handleRequest(
  request: Request,
  context: RequestContext,
  peerAddress?: string
): Promise<Response> {
  const oversizedHeader = [
    ["llm-space-continuation", 1_024],
    ["llm-space-next-continuation", 1_024],
    ["last-event-id", 64]
  ] as const;
  if (oversizedHeader.some(([name, limit]) =>
    new TextEncoder().encode(request.headers.get(name) ?? "").byteLength > limit)) {
    return _error(413, "request_too_large");
  }
  if (
    request.method === "POST"
    && _contentLength(request) > MAX_JSON_BODY_BYTES
  ) {
    return _error(413, "request_too_large");
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (_isLoopbackProbe(request, url, peerAddress)) {
    if (origin && !context.allowedOrigins.has(origin)) {
      return _error(403, "origin_forbidden");
    }
    const response = await _routeRequest(request, context, url);
    return origin ? _corsResponse(response, origin) : response;
  }
  if (context.trustedProxyCidrs.length > 0) {
    if (
      !peerAddress
      || !isTrustedProxyAddress(peerAddress, context.trustedProxyCidrs)
    ) {
      return _error(403, "untrusted_proxy");
    }
    if (!_forwardedHttps(request)) {
      return _error(400, "https_required");
    }
  }
  if (!context.allowedHosts.has(url.host)) {
    return _error(400, "invalid_host");
  }
  if (origin && !context.allowedOrigins.has(origin)) {
    return _error(403, "origin_forbidden");
  }
  if (request.method === "OPTIONS") {
    if (!origin) {
      return _error(403, "origin_forbidden");
    }
    return _preflightResponse(request, url, origin);
  }
  const response = await _routeRequest(request, context, url);
  return origin ? _corsResponse(response, origin) : response;
}

function _isLoopbackProbe(
  request: Request,
  url: URL,
  peerAddress?: string
): boolean {
  return request.method === "GET"
    && (url.pathname === "/v1/health" || url.pathname === "/v1/ready")
    && _isLoopbackHost(url.hostname)
    && Boolean(peerAddress && _isLoopbackPeer(peerAddress));
}

function _isLoopbackPeer(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("127.")
    || normalized.startsWith("::ffff:127.");
}

function _forwardedHttps(request: Request): boolean {
  const forwardedProto = _singleForwardedProto(
    request.headers.get("forwarded")
  );
  const xForwardedProto = _singleXForwardedProto(
    request.headers.get("x-forwarded-proto")
  );
  if (forwardedProto === false || xForwardedProto === false) {
    return false;
  }
  const signals = [forwardedProto, xForwardedProto].filter(
    (value): value is string => typeof value === "string"
  );
  return signals.length > 0 && signals.every(value => value === "https");
}

function _singleForwardedProto(value: string | null): false | string | null {
  if (value === null) {
    return null;
  }
  const elements = value.split(",");
  if (elements.length !== 1) {
    return false;
  }
  const protoParts = elements[0]
    ?.split(";")
    .map(part => part.trim())
    .filter(part => /^proto\s*=/i.test(part))
    ?? [];
  if (protoParts.length !== 1) {
    return false;
  }
  const match = /^proto=(?:"(https|http)"|(https|http))$/i.exec(
    protoParts[0] ?? ""
  );
  return (match?.[1] ?? match?.[2])?.toLowerCase() ?? false;
}

function _singleXForwardedProto(value: string | null): false | string | null {
  if (value === null) {
    return null;
  }
  const parts = value.split(",").map(part => part.trim().toLowerCase());
  return parts.length === 1 && (parts[0] === "https" || parts[0] === "http")
    ? parts[0]
    : false;
}

async function _routeRequest(
  request: Request,
  context: RequestContext,
  url: URL
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/v1/health") {
    return _json({ status: "ok" });
  }
  if (request.method === "GET" && url.pathname === "/v1/ready") {
    return context.accepting
      ? _json({ status: "ready" })
      : _error(503, "not_ready");
  }
  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    if (!context.accepting) {
      return _error(503, "shutting_down");
    }
    return _createSession(request, context);
  }
  const runCollection = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/runs$/
  );
  if (request.method === "POST" && runCollection) {
    if (!context.accepting) {
      return _error(503, "shutting_down");
    }
    return _createRun(
      request,
      context,
      decodeURIComponent(_capture(runCollection, 1))
    );
  }
  const runEvents = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/events$/
  );
  if (request.method === "GET" && runEvents) {
    return _observeRun(
      request,
      context,
      decodeURIComponent(_capture(runEvents, 1)),
      decodeURIComponent(_capture(runEvents, 2))
    );
  }
  const runAbort = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/abort$/
  );
  if (request.method === "POST" && runAbort) {
    return _abortRun(
      request,
      context,
      decodeURIComponent(_capture(runAbort, 1)),
      decodeURIComponent(_capture(runAbort, 2))
    );
  }
  const toolApproval = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/approvals\/([^/]+)$/
  );
  if (request.method === "POST" && toolApproval) {
    return _decideToolApproval(
      request,
      context,
      decodeURIComponent(_capture(toolApproval, 1)),
      decodeURIComponent(_capture(toolApproval, 2)),
      decodeURIComponent(_capture(toolApproval, 3))
    );
  }
  const sessionBudget = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/budget$/
  );
  if (request.method === "POST" && sessionBudget) {
    return _decideSessionBudget(
      request,
      context,
      decodeURIComponent(_capture(sessionBudget, 1)),
      decodeURIComponent(_capture(sessionBudget, 2))
    );
  }
  const runtimeBranch = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/branches\/([^/]+)$/
  );
  if (request.method === "POST" && runtimeBranch) {
    return _renameRuntimeBranch(
      request,
      context,
      decodeURIComponent(_capture(runtimeBranch, 1)),
      decodeURIComponent(_capture(runtimeBranch, 2))
    );
  }
  const continuation = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/continuation\/(rotate|revoke)$/
  );
  if (request.method === "POST" && continuation) {
    const sessionId = decodeURIComponent(_capture(continuation, 1));
    return _capture(continuation, 2) === "rotate"
      ? _rotateContinuation(request, context, sessionId)
      : _revokeContinuation(request, context, sessionId);
  }
  return _error(404, "not_found");
}

function _capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (!value) {
    throw new Error("Agent Server route capture is missing");
  }
  return value;
}

async function _createSession(
  request: Request,
  context: RequestContext
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) {
    return _unauthorized();
  }
  const bodyError = await _emptyBodyError(request);
  if (bodyError) {
    return bodyError;
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  const continuationToken = request.headers.get("llm-space-next-continuation");
  if (!idempotencyKey || !continuationToken) {
    return _error(400, "invalid_request");
  }
  try {
    const session = await context.repository.createSession({
      owner: principal,
      idempotencyKey,
      continuationToken
    });
    return _json(session, 201);
  } catch (error) {
    return _mappedError(error);
  }
}

async function _createRun(
  request: Request,
  context: RequestContext,
  sessionId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) {
    return _unauthorized();
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) {
    return _error(404, "not_found");
  }
  try {
    context.repository.authorizedTranscript({
      sessionId,
      owner: principal,
      continuationToken
    });
  } catch (error) {
    return _mappedError(error);
  }
  if (!idempotencyKey) {
    return _error(400, "invalid_request");
  }
  const parsed = await _runInput(request);
  if (parsed instanceof Response) {
    return parsed;
  }
  try {
    const run = await context.runs.createRun({
      sessionId,
      owner: principal,
      continuationToken,
      idempotencyKey,
      text: parsed.text,
      ...(parsed.workingBase ? { workingBase: parsed.workingBase } : {}),
      ...(parsed.outputContract
        ? { outputContract: parsed.outputContract }
        : {})
    });
    return _json(
      { schemaVersion: 1, sessionId: run.sessionId, runId: run.runId },
      202
    );
  } catch (error) {
    return _mappedError(error);
  }
}

async function _renameRuntimeBranch(
  request: Request,
  context: RequestContext,
  sessionId: string,
  branchId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) { return _unauthorized(); }
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) { return _error(404, "not_found"); }
  const bytes = await _bodyBytes(request);
  if (!bytes) { return _error(413, "request_too_large"); }
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).length !== 1
      || !("label" in value)
      || typeof value.label !== "string"
      || value.label.trim().length === 0
      || value.label.trim().length > MAX_RUNTIME_BRANCH_LABEL_LENGTH
    ) {
      return _error(400, "invalid_request");
    }
    return _json(await context.repository.renameBranch({
      branchId,
      continuationToken,
      label: value.label,
      owner: principal,
      sessionId
    }));
  } catch (error) {
    return _mappedError(error);
  }
}

async function _observeRun(
  request: Request,
  context: RequestContext,
  sessionId: string,
  runId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) {
    return _unauthorized();
  }
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) {
    return _error(404, "not_found");
  }
  try {
    await context.repository.authorizeRun({
      sessionId,
      runId,
      owner: principal,
      continuationToken
    });
  } catch (error) {
    return _mappedError(error);
  }
  const cursor = request.headers.get("last-event-id");
  if (cursor && (cursor.length > 64 || !/^[1-9]\d*$/.test(cursor))) {
    return _error(400, "invalid_cursor");
  }
  try {
    const pending: ObservedServerEvent[] = [];
    let deliver = (event: ObservedServerEvent) => { pending.push(event); };
    let disconnectPending = false;
    let disconnect = () => { disconnectPending = true; };
    const observation = await context.repository.observeRun({
      sessionId,
      runId,
      owner: principal,
      continuationToken,
      listener: event => { deliver(event); },
      disconnect: () => { disconnect(); },
      ...(cursor ? { afterSequence: Number(cursor) } : {})
    });
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let pendingBytes = 0;
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (bytes: Uint8Array): boolean => {
          pendingBytes += bytes.byteLength;
          if (pendingBytes <= 1024 * 1024) {
            controller.enqueue(bytes);
            return true;
          }
          closed = true;
          unsubscribe();
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          controller.error(new Error("Agent Server observer is too slow"));
          return false;
        };
        unsubscribe = observation.unsubscribe;
        disconnect = () => {
          if (closed) {
            return;
          }
          closed = true;
          unsubscribe();
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          controller.close();
        };
        if (disconnectPending) {
          disconnect();
          return;
        }
        deliver = event => {
          if (closed) {
            return;
          }
          const bytes = encoder.encode(_sse(event));
          if (!enqueue(bytes)) {
            return;
          }
          if (_isTerminal(event)) {
            closed = true;
            unsubscribe();
            if (heartbeat) {
              clearInterval(heartbeat);
            }
            controller.close();
          }
        };
        for (const event of observation.events) {
          deliver(event);
          if (closed) {
            break;
          }
        }
        for (const event of pending.splice(0)) {
          deliver(event);
          if (closed) {
            break;
          }
        }
        if (observation.terminal && !closed) {
          closed = true;
          unsubscribe();
          controller.close();
          return;
        }
        if (!closed) {
          heartbeat = setInterval(() => {
            enqueue(encoder.encode(": heartbeat\n\n"));
          }, 15_000);
        }
      },
      pull() {
        pendingBytes = 0;
      },
      cancel() {
        unsubscribe();
        if (heartbeat) {
          clearInterval(heartbeat);
        }
      }
    });
    return new Response(body, {
      headers: {
        "cache-control": "no-cache, no-store",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-llm-space-pi-version": "0.80.3"
      }
    });
  } catch (error) {
    return _mappedError(error);
  }
}

async function _abortRun(
  request: Request,
  context: RequestContext,
  sessionId: string,
  runId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) {
    return _unauthorized();
  }
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) {
    return _error(404, "not_found");
  }
  try {
    await context.repository.authorizeRun({
      sessionId,
      runId,
      owner: principal,
      continuationToken
    });
    const bodyError = await _emptyBodyError(request);
    if (bodyError) {
      return bodyError;
    }
    const terminal = await context.repository.runTerminal({
      sessionId,
      runId,
      owner: principal,
      continuationToken
    });
    if (terminal) {
      return _json({ status: "terminal", outcome: terminal });
    }
    const current = await context.repository.load(sessionId);
    const runtimeRun = current?.snapshot.runs.find(run => run.id === runId);
    if (current && runtimeRun?.state === "waitingForBudget") {
      await decideRuntimeSessionBudget(context.repository, {
        decision: "stop",
        expectedVersion: current.version,
        runId,
        sessionId
      });
      await context.repository.completeRun({
        sessionId,
        runId,
        outcome: "cancelled"
      });
      return _json({ status: "terminal", outcome: "cancelled" });
    }
    context.runs.abort(runId);
    return _json({ status: "aborting" }, 202);
  } catch (error) {
    return _mappedError(error);
  }
}

async function _decideToolApproval(
  request: Request,
  context: RequestContext,
  sessionId: string,
  runId: string,
  requestId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) { return _unauthorized(); }
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) { return _error(404, "not_found"); }
  try {
    await context.repository.authorizeRun({
      sessionId,
      runId,
      owner: principal,
      continuationToken
    });
  } catch (error) {
    return _mappedError(error);
  }
  const bytes = await _bodyBytes(request);
  if (!bytes) { return _error(413, "request_too_large"); }
  let decision: "approved" | "denied";
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).length !== 1
      || !("decision" in value)
      || (value.decision !== "approved" && value.decision !== "denied")
    ) {
      return _error(400, "invalid_request");
    }
    decision = value.decision;
  } catch {
    return _error(400, "invalid_json");
  }
  try {
    const child = context.repository.subagentRuns(sessionId).find(candidate =>
      candidate.parent.runId === runId
      && candidate.runtime.snapshot.approvalLedger?.requests.some(
        request => request.id === requestId
      ));
    if (child) {
      const current = await context.repository.load(child.child.sessionId);
      if (!current) { return _error(404, "not_found"); }
      const decided = await decideRuntimeToolApproval(context.repository, {
        actor: { current: principal, initiator: principal },
        decision,
        expectedVersion: current.version,
        requestId,
        runId: child.child.runId,
        sessionId: child.child.sessionId
      });
      const pending = decided.snapshot.approvalLedger?.requests.some(
        approval => approval.runId === child.child.runId
          && approval.state === "pending"
      ) ?? false;
      if (!pending) {
        context.runs.resumeRun(
          context.repository.recoverableRun(sessionId, runId)
        );
      }
      return _json({
        schemaVersion: 1,
        requestId,
        decision,
        status: pending ? "waitingForApproval" : "resuming"
      }, 202);
    }
    const current = await context.repository.load(sessionId);
    if (!current) { return _error(404, "not_found"); }
    const decided = await decideRuntimeToolApproval(context.repository, {
      actor: { current: principal, initiator: principal },
      decision,
      expectedVersion: current.version,
      requestId,
      runId,
      sessionId
    });
    const pending = decided.snapshot.approvalLedger?.requests.some(
      approval => approval.runId === runId && approval.state === "pending"
    ) ?? false;
    if (!pending) {
      const resumed = await context.repository.commit({
        sessionId,
        expectedVersion: decided.version,
        mutations: [{ type: "transitionRun", runId, to: "runningTools" }]
      });
      void resumed;
      context.runs.resumeRun(context.repository.recoverableRun(sessionId, runId));
    }
    return _json({
      schemaVersion: 1,
      requestId,
      decision,
      status: pending ? "waitingForApproval" : "resuming"
    }, 202);
  } catch (error) {
    return _mappedError(error);
  }
}

async function _decideSessionBudget(
  request: Request,
  context: RequestContext,
  sessionId: string,
  runId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) { return _unauthorized(); }
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) { return _error(404, "not_found"); }
  try {
    await context.repository.authorizeRun({
      sessionId,
      runId,
      owner: principal,
      continuationToken
    });
  } catch (error) {
    return _mappedError(error);
  }
  const bytes = await _bodyBytes(request);
  if (!bytes) { return _error(413, "request_too_large"); }
  let decision: "freshWindow" | "stop";
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).length !== 1
      || !("decision" in value)
      || (value.decision !== "freshWindow" && value.decision !== "stop")
    ) {
      return _error(400, "invalid_request");
    }
    decision = value.decision;
  } catch {
    return _error(400, "invalid_json");
  }
  try {
    const current = await context.repository.load(sessionId);
    if (!current) { return _error(404, "not_found"); }
    const decided = await decideRuntimeSessionBudget(context.repository, {
      decision,
      expectedVersion: current.version,
      runId,
      sessionId
    });
    if (decision === "freshWindow") {
      context.runs.resumeRun(context.repository.recoverableRun(sessionId, runId));
    } else {
      await context.repository.completeRun({
        sessionId,
        runId,
        outcome: "cancelled"
      });
    }
    return _json({
      schemaVersion: 1,
      decision,
      session: decided,
      status: decision === "freshWindow" ? "resuming" : "stopped"
    }, 202);
  } catch (error) {
    return _mappedError(error);
  }
}

async function _rotateContinuation(
  request: Request,
  context: RequestContext,
  sessionId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) {
    return _unauthorized();
  }
  const continuationToken = request.headers.get("llm-space-continuation");
  const nextContinuationToken = request.headers.get(
    "llm-space-next-continuation"
  );
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!continuationToken) {
    return _error(404, "not_found");
  }
  if (!nextContinuationToken || !idempotencyKey) {
    return _error(400, "invalid_request");
  }
  try {
    context.repository.authorizeContinuationRotation({
      sessionId,
      owner: principal,
      continuationToken,
      nextContinuationToken,
      idempotencyKey
    });
  } catch (error) {
    return _mappedError(error);
  }
  const bodyError = await _emptyBodyError(request);
  if (bodyError) {
    return bodyError;
  }
  try {
    return _json(await context.repository.rotateContinuation({
      sessionId,
      owner: principal,
      continuationToken,
      nextContinuationToken,
      idempotencyKey
    }));
  } catch (error) {
    return _mappedError(error);
  }
}

async function _revokeContinuation(
  request: Request,
  context: RequestContext,
  sessionId: string
): Promise<Response> {
  const principal = await _authenticate(request, context.authenticator);
  if (!principal) {
    return _unauthorized();
  }
  const continuationToken = request.headers.get("llm-space-continuation");
  if (!continuationToken) {
    return _error(404, "not_found");
  }
  try {
    context.repository.authorizedTranscript({
      sessionId,
      owner: principal,
      continuationToken
    });
    const bodyError = await _emptyBodyError(request);
    if (bodyError) {
      return bodyError;
    }
    await context.repository.revokeContinuation({
      sessionId,
      owner: principal,
      continuationToken
    });
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return _mappedError(error);
  }
}

async function _runInput(request: Request): Promise<
  | {
    readonly outputContract?: string;
    readonly text: string;
    readonly workingBase?: RuntimeWorkingBase;
  }
  | Response
> {
  const bytes = await _bodyBytes(request);
  if (!bytes) {
    return _error(413, "request_too_large");
  }
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).some(key =>
        key !== "input" && key !== "outputContract" && key !== "workingBase")
      || !("input" in value)
      || !value.input
      || typeof value.input !== "object"
      || Array.isArray(value.input)
    ) {
      return _error(400, "invalid_request");
    }
    const input = value.input as Record<string, unknown>;
    if (
      Object.keys(input).length !== 2
      || input.type !== "text"
      || typeof input.text !== "string"
    ) {
      return _error(400, "invalid_request");
    }
    const outputContract = "outputContract" in value
      ? value.outputContract
      : undefined;
    if (
      outputContract !== undefined
      && (typeof outputContract !== "string"
        || outputContract.length === 0
        || outputContract.length > 128)
    ) {
      return _error(400, "invalid_request");
    }
    const workingBase = "workingBase" in value
      ? value.workingBase
      : undefined;
    if (
      workingBase !== undefined
      && (
        !workingBase
        || typeof workingBase !== "object"
        || Array.isArray(workingBase)
        || Object.keys(workingBase).length !== 2
        || !("branchId" in workingBase)
        || typeof workingBase.branchId !== "string"
        || workingBase.branchId.length === 0
        || !("checkpointId" in workingBase)
        || typeof workingBase.checkpointId !== "string"
        || workingBase.checkpointId.length === 0
      )
    ) {
      return _error(400, "invalid_request");
    }
    if (new TextEncoder().encode(input.text).byteLength > MAX_TEXT_INPUT_BYTES) {
      return _error(413, "input_too_large");
    }
    return {
      text: input.text,
      ...(workingBase
        ? { workingBase: workingBase as RuntimeWorkingBase }
        : {}),
      ...(outputContract ? { outputContract } : {})
    };
  } catch {
    return _error(400, "invalid_request");
  }
}

async function _emptyBodyError(request: Request): Promise<Response | null> {
  const bytes = await _bodyBytes(request);
  if (!bytes) {
    return _error(413, "request_too_large");
  }
  return bytes.byteLength === 0 ? null : _error(400, "invalid_request");
}

async function _bodyBytes(request: Request): Promise<Uint8Array | null> {
  if (_contentLength(request) > MAX_JSON_BODY_BYTES) {
    return null;
  }
  if (!request.body) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_JSON_BODY_BYTES) {
        await reader.cancel("Agent Server request body is too large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function _contentLength(request: Request): number {
  const value = request.headers.get("content-length");
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function _authenticate(
  request: Request,
  authenticator: ServerAuthenticator
): Promise<ServerPrincipal | null> {
  let principal: ServerPrincipal | null;
  try {
    principal = await authenticator.authenticate(request);
  } catch {
    return null;
  }
  if (!principal) {
    return null;
  }
  const identity: ServerPrincipal = {
    issuer: principal.issuer,
    principalId: principal.principalId,
    principalType: principal.principalType,
    ...(principal.tenant ? { tenant: { ...principal.tenant } } : {})
  };
  if (
    typeof identity.issuer !== "string"
    || identity.issuer.length === 0
    || identity.issuer.length > 256
    || typeof identity.principalId !== "string"
    || identity.principalId.length === 0
    || identity.principalId.length > 256
    || (identity.principalType !== "service"
      && identity.principalType !== "user")
    || (identity.tenant !== undefined && (
      typeof identity.tenant.issuer !== "string"
      || identity.tenant.issuer.length === 0
      || identity.tenant.issuer.length > 256
      || typeof identity.tenant.tenantId !== "string"
      || identity.tenant.tenantId.length === 0
      || identity.tenant.tenantId.length > 256
    ))
  ) {
    throw new TypeError("Server authenticator returned an invalid principal");
  }
  return identity;
}

function _sse(event: ObservedServerEvent): string {
  const id = event.sequence === null ? "" : `id: ${event.sequence}\n`;
  return `${id}event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function _isTerminal(event: ObservedServerEvent): boolean {
  return event.event === "control"
    && (event.data as { type?: string; }).type === "runTerminal";
}

function _mappedError(error: unknown): Response {
  if (error instanceof ServerHiddenSessionError) {
    return _error(404, "not_found");
  }
  if (error instanceof ServerCursorError) {
    return _error(400, "invalid_cursor");
  }
  if (error instanceof ServerIdempotencyConflictError) {
    return _error(409, "idempotency_conflict");
  }
  if (error instanceof ServerRunConflictError) {
    return _error(409, "active_run_conflict");
  }
  if (error instanceof ServerCapacityError) {
    return _error(429, "capacity_exhausted", { "retry-after": "1" });
  }
  if (error instanceof TypeError) {
    return _error(400, "invalid_request");
  }
  throw error;
}

async function _waitForIdle(
  runs: ServerRunController,
  timeoutSeconds: number
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runs.waitForIdle().then(() => true),
      new Promise<false>(resolveTimeout => {
        timeout = setTimeout(
          () => { resolveTimeout(false); },
          timeoutSeconds * 1_000
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function _assertIntegerOption(
  value: number,
  minimum: number,
  maximum: number,
  name: string
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${name} must be an integer from ${minimum} through ${maximum}`
    );
  }
}

function _isLoopbackHost(hostname: string | undefined): boolean {
  return hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]"
    || hostname === "localhost";
}

function _normalizeAllowedHost(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Allowed Hosts must be exact host or host:port values");
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new TypeError("Allowed Hosts must be exact host or host:port values");
  }
  if (
    parsed.host !== value.toLowerCase()
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.pathname !== "/"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw new TypeError("Allowed Hosts must be exact host or host:port values");
  }
  return parsed.host;
}

function _isPublicAllowedHost(host: string): boolean {
  const hostname = new URL(`http://${host}`).hostname;
  return !_isLoopbackHost(hostname)
    && hostname !== "0.0.0.0"
    && hostname !== "::"
    && hostname !== "[::]";
}

function _corsResponse(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  return _varyOrigin(
    new Response(response.body, { status: response.status, headers })
  );
}

function _varyOrigin(response: Response): Response {
  const headers = new Headers(response.headers);
  const vary = headers.get("vary")
    ?.split(",")
    .map(value => value.trim().toLowerCase())
    ?? [];
  if (!vary.includes("origin") && !vary.includes("*")) {
    headers.append("vary", "Origin");
  }
  return new Response(response.body, { status: response.status, headers });
}

function _preflightResponse(
  request: Request,
  url: URL,
  origin: string
): Response {
  const requestedMethod = request.headers.get("access-control-request-method")
    ?.toUpperCase();
  if (!requestedMethod || !_routeSupportsMethod(url.pathname, requestedMethod)) {
    return _error(403, "preflight_forbidden");
  }
  const allowedHeaders = new Set([
    "authorization",
    "content-type",
    "idempotency-key",
    "llm-space-continuation",
    "llm-space-next-continuation",
    "last-event-id"
  ]);
  const requestedHeaders = (request.headers.get("access-control-request-headers")
    ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some(header => !allowedHeaders.has(header))) {
    return _error(403, "preflight_forbidden");
  }
  const response = _corsResponse(new Response(null, { status: 204 }), origin);
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-methods", requestedMethod);
  if (requestedHeaders.length > 0) {
    headers.set("access-control-allow-headers", requestedHeaders.join(", "));
  }
  return new Response(null, { status: 204, headers });
}

function _routeSupportsMethod(pathname: string, method: string): boolean {
  if (method === "GET") {
    return pathname === "/v1/health"
      || pathname === "/v1/ready"
      || /^\/v1\/sessions\/[^/]+\/runs\/[^/]+\/events$/.test(pathname);
  }
  if (method !== "POST") {
    return false;
  }
  return pathname === "/v1/sessions"
    || /^\/v1\/sessions\/[^/]+\/runs$/.test(pathname)
    || /^\/v1\/sessions\/[^/]+\/runs\/[^/]+\/abort$/.test(pathname)
    || /^\/v1\/sessions\/[^/]+\/continuation\/(rotate|revoke)$/.test(
      pathname
    );
}

function _json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function _unauthorized(): Response {
  return _error(401, "unauthorized", { "www-authenticate": "Bearer" });
}

function _error(
  status: number,
  code: string,
  headers: Record<string, string> = {}
): Response {
  return Response.json(
    { schemaVersion: 1, error: { code } },
    {
      status,
      headers: { ...headers, "cache-control": "no-store" }
    }
  );
}
