import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type {
  RemoteDisconnectResult,
  RemoteServerDraft,
  RemoteServerStatusChangedPayload,
  RemoteServerView,
} from "../../shared/remote-servers";
import type { RemoteServerManager } from "../remote";

export interface RemoteServersApplicationApi {
  list(): Promise<RemoteServerView[]>;
  add(server: RemoteServerDraft): Promise<RemoteServerView[]>;
  update(serverId: string, server: RemoteServerDraft): Promise<RemoteServerView[]>;
  remove(serverId: string): Promise<RemoteServerView[]>;
  connect(serverId: string): Promise<RemoteServerView[]>;
  trustHostKey(serverId: string, requestId: string): Promise<RemoteServerView[]>;
  rejectHostKey(serverId: string, requestId: string): Promise<RemoteServerView[]>;
  disconnect(serverId: string): Promise<RemoteDisconnectResult>;
}
export interface RemoteServersApplicationEvents {
  statusChanged: RemoteServerStatusChangedPayload;
}

/** Owns Remote Server lifecycle use cases and their transient status events. */
export class RemoteServersApplication
  implements RemoteServersApplicationApi, Disposable
{
  readonly events = new EventHub<RemoteServersApplicationEvents>();

  constructor(private readonly _manager: RemoteServerManager) {
    this._manager.setStatusListener((payload) =>
      this.events.publish("statusChanged", payload)
    );
  }

  /** Return configured servers with current connection projections. */
  list() {
    return Promise.resolve(this._manager.listServers());
  }

  /** Persist one Remote Server definition. */
  add(server: RemoteServerDraft) {
    return Promise.resolve(this._manager.addServer(server));
  }

  /** Update one disconnected Remote Server definition. */
  update(
    serverId: string,
    server: RemoteServerDraft
  ) {
    return Promise.resolve(this._manager.updateServer(serverId, server));
  }

  /** Remove one disconnected Remote Server definition. */
  remove(serverId: string) {
    return this._manager.removeServer(serverId);
  }

  /** Establish a Runtime backed by the selected Remote Server. */
  connect(serverId: string) {
    return this._manager.connectServer(serverId);
  }

  /** Accept the exact pending SSH host-key challenge. */
  trustHostKey(serverId: string, requestId: string) {
    return this._manager.trustServerHostKey(serverId, requestId);
  }

  /** Reject the exact pending SSH host-key challenge. */
  rejectHostKey(serverId: string, requestId: string) {
    return this._manager.rejectServerHostKey(serverId, requestId);
  }

  /** Disconnect a server while preserving any remote-stop failure detail. */
  disconnect(serverId: string) {
    return this._manager.disconnectServer(serverId);
  }

  /** Detach the manager callback and release every renderer event listener. */
  dispose(): void {
    this._manager.setStatusListener(undefined);
    this.events.dispose();
  }
}
