import { createRpcClientProxy } from "@/shared/namespaced-rpc";
import { REMOTE_SERVERS_RPC } from "@/shared/remote-rpc";
import type {
  RemoteDisconnectResult,
  RemoteServerDraft,
  RemoteServerStatusChangedPayload,
  RemoteServerView,
} from "@/shared/remote-servers";
import type { RuntimeId, RuntimeView } from "@/shared/runtime";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";
import { runtimesClient } from "./runtime-rpc-clients";

const remoteServersClient = createRpcClientProxy(
  REMOTE_SERVERS_RPC,
  createElectrobunRpcClientTransport()
);

const REMOTE_SERVERS_CHANGED_EVENT = "llm-space:remote-servers-changed";

export function notifyRemoteServersChanged(servers?: RemoteServerView[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(REMOTE_SERVERS_CHANGED_EVENT, { detail: { servers } })
  );
}

export function subscribeRemoteServersChanged(
  listener: (servers?: RemoteServerView[]) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handle = (event: Event) => {
    listener(
      (event as CustomEvent<{ servers?: RemoteServerView[] }>).detail?.servers
    );
  };
  window.addEventListener(REMOTE_SERVERS_CHANGED_EVENT, handle);
  return () => window.removeEventListener(REMOTE_SERVERS_CHANGED_EVENT, handle);
}

export function subscribeRemoteServerStatusChanged(
  listener: (payload: RemoteServerStatusChangedPayload) => void
): () => void {
  const subscription = remoteServersClient.on("statusChanged", (payload) => {
    notifyRemoteServersChanged(payload.servers);
    listener(payload);
  });
  return () => subscription.dispose();
}

export function listRuntimes(): Promise<RuntimeView[]> {
  return runtimesClient.list();
}

export function listRemoteServers(): Promise<RemoteServerView[]> {
  return remoteServersClient.list();
}

export function addRemoteServer(
  server: RemoteServerDraft
): Promise<RemoteServerView[]> {
  return _notifyAfter(remoteServersClient.add(server));
}

export function updateRemoteServer(
  serverId: string,
  server: RemoteServerDraft
): Promise<RemoteServerView[]> {
  return _notifyAfter(remoteServersClient.update(serverId, server));
}

export function removeRemoteServer(
  serverId: string
): Promise<RemoteServerView[]> {
  return _notifyAfter(remoteServersClient.remove(serverId));
}

export function connectRemoteServer(
  serverId: string
): Promise<RemoteServerView[]> {
  return _notifyAfter(remoteServersClient.connect(serverId));
}

export function trustRemoteServerHostKey(
  serverId: string,
  requestId: string
): Promise<RemoteServerView[]> {
  return _notifyAfter(remoteServersClient.trustHostKey(serverId, requestId));
}

export function rejectRemoteServerHostKey(
  serverId: string,
  requestId: string
): Promise<RemoteServerView[]> {
  return _notifyAfter(remoteServersClient.rejectHostKey(serverId, requestId));
}

export function disconnectRemoteServer(
  serverId: string
): Promise<RemoteDisconnectResult> {
  return _notifyAfter(remoteServersClient.disconnect(serverId));
}

export async function setDefaultRuntime(
  runtimeId: RuntimeId
): Promise<RemoteServerView[]> {
  await runtimesClient.setDefault(runtimeId);
  return _notifyAfter(listRemoteServers());
}

export async function getDefaultRuntime(): Promise<RuntimeId> {
  return runtimesClient.getDefault();
}

async function _notifyAfter<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  notifyRemoteServersChanged();
  return result;
}
