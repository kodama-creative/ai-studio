import { defineRpcNamespace } from "./namespaced-rpc";
import type {
  RemoteDisconnectResult,
  RemoteServerDraft,
  RemoteServerStatusChangedPayload,
  RemoteServerView,
} from "./remote-servers";

export interface RemoteServersRequests {
  list(): Promise<RemoteServerView[]>;
  add(server: RemoteServerDraft): Promise<RemoteServerView[]>;
  update(
    serverId: string,
    server: RemoteServerDraft
  ): Promise<RemoteServerView[]>;
  remove(serverId: string): Promise<RemoteServerView[]>;
  connect(serverId: string): Promise<RemoteServerView[]>;
  trustHostKey(
    serverId: string,
    requestId: string
  ): Promise<RemoteServerView[]>;
  rejectHostKey(
    serverId: string,
    requestId: string
  ): Promise<RemoteServerView[]>;
  disconnect(serverId: string): Promise<RemoteDisconnectResult>;
}

export interface RemoteServersEvents {
  statusChanged: RemoteServerStatusChangedPayload;
}

export interface RemoteServersRpc {
  readonly requests: RemoteServersRequests;
  readonly streams: Record<never, never>;
  readonly events: RemoteServersEvents;
}

export const REMOTE_SERVERS_RPC = defineRpcNamespace<RemoteServersRpc>(
  "remoteServers",
  { streams: [], events: ["statusChanged"] }
);
