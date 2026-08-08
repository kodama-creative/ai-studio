export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteHandlerArgs<TState = undefined> {
  readonly from: unknown;
  readonly resolveSession: unknown;
  readonly attachSession: (sessionId: string) => unknown;
  readonly to: unknown;
  readonly params: Readonly<Record<string, string>>;
  readonly requestIp: string | null;
  readonly waitUntil: (task: Promise<unknown>) => void;
  readonly state?: TState;
}

export type RouteHandler<TState = undefined> = (
  request: Request,
  args: RouteHandlerArgs<TState>
) => Promise<Response> | Response;

export interface WebSocketPeer {
  readonly id: string;
  readonly context: Record<string, unknown>;
  readonly namespace: string;
  readonly request: Request;
  readonly remoteAddress?: string;
  readonly topics: Set<string>;
  close(code?: number, reason?: string): void;
  publish(topic: string, data: unknown, options?: { compress?: boolean }): void;
  send(data: unknown, options?: { compress?: boolean }): number | void;
  subscribe(topic: string): void;
  terminate(): void;
  unsubscribe(topic: string): void;
}

export interface WebSocketMessage {
  readonly data: unknown;
  readonly id: string;
  readonly rawData: unknown;
  arrayBuffer(): ArrayBuffer | SharedArrayBuffer;
  blob(): Blob;
  json<T = unknown>(): T;
  text(): string;
  uint8Array(): Uint8Array;
}

export interface WebSocketUpgradeRequest extends Request {
  readonly context?: Record<string, unknown>;
}

export type WebSocketUpgradeResult =
  | {
      readonly context?: Record<string, unknown>;
      readonly handled?: boolean;
      readonly headers?: Headers | Readonly<Record<string, string>>;
      readonly namespace?: string;
    }
  | Response
  | void;

export interface WebSocketRouteHooks {
  close?(
    peer: WebSocketPeer,
    details: { code?: number; reason?: string }
  ): void | Promise<void>;
  error?(peer: WebSocketPeer, error: Error): void | Promise<void>;
  message?(
    peer: WebSocketPeer,
    message: WebSocketMessage
  ): void | Promise<void>;
  open?(peer: WebSocketPeer): void | Promise<void>;
  upgrade?(
    request: WebSocketUpgradeRequest
  ): WebSocketUpgradeResult | Promise<WebSocketUpgradeResult>;
}

export type WebSocketRouteHandler<TState = undefined> = (
  request: Request,
  args: RouteHandlerArgs<TState>
) => WebSocketRouteHooks | Promise<WebSocketRouteHooks>;

export interface HttpRouteDefinition<TState = undefined> {
  readonly transport?: "http";
  readonly method: RouteMethod;
  readonly path: string;
  readonly handler: RouteHandler<TState>;
}

export interface WebSocketRouteDefinition<TState = undefined> {
  readonly transport: "websocket";
  readonly method: "WEBSOCKET";
  readonly path: string;
  readonly handler: WebSocketRouteHandler<TState>;
}

export type RouteDefinition<TState = undefined> =
  HttpRouteDefinition<TState> | WebSocketRouteDefinition<TState>;

function _route<TState>(
  method: RouteMethod,
  path: string,
  handler: RouteHandler<TState>
): HttpRouteDefinition<TState> {
  return { transport: "http", method, path, handler };
}

export const GET = <TState = undefined>(
  path: string,
  handler: RouteHandler<TState>
) => _route("GET", path, handler);
export const POST = <TState = undefined>(
  path: string,
  handler: RouteHandler<TState>
) => _route("POST", path, handler);
export const PUT = <TState = undefined>(
  path: string,
  handler: RouteHandler<TState>
) => _route("PUT", path, handler);
export const PATCH = <TState = undefined>(
  path: string,
  handler: RouteHandler<TState>
) => _route("PATCH", path, handler);
export const DELETE = <TState = undefined>(
  path: string,
  handler: RouteHandler<TState>
) => _route("DELETE", path, handler);

export function WS<TState = undefined>(
  path: string,
  handler: WebSocketRouteHandler<TState>
): WebSocketRouteDefinition<TState> {
  return { transport: "websocket", method: "WEBSOCKET", path, handler };
}
