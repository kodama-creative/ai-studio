import {
  ANALYTICS_RPC,
  GITHUB_ACCOUNT_RPC,
  REMINDERS_RPC,
  THREAD_SHARING_RPC,
  UPDATES_RPC,
  type AnalyticsRpc,
  type GithubAccountRpc,
  type RemindersRpc,
  type ThreadSharingRpc,
  type UpdatesRpc,
} from "../../shared/application-rpc";
import type { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type {
  AnalyticsApplicationApi,
  GithubAccountApplicationEvents,
  GithubAccountApplicationApi,
  RemindersApplicationApi,
  ThreadSharingApplicationApi,
  UpdatesApplicationEvents,
  UpdatesApplicationApi,
} from "../application/application-services";

export class ThreadSharingRpcServer implements RpcServer<ThreadSharingRpc> {
  readonly namespace = THREAD_SHARING_RPC;
  readonly streams = {};
  constructor(readonly requests: ThreadSharingApplicationApi) {}
}
export class GithubAccountRpcServer implements RpcServer<GithubAccountRpc> {
  readonly namespace = GITHUB_ACCOUNT_RPC;
  readonly streams = {};
  readonly eventSource;
  constructor(
    readonly requests: GithubAccountApplicationApi,
    events: EventHub<GithubAccountApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
export class UpdatesRpcServer implements RpcServer<UpdatesRpc> {
  readonly namespace = UPDATES_RPC;
  readonly streams = {};
  readonly eventSource;
  constructor(
    readonly requests: UpdatesApplicationApi,
    events: EventHub<UpdatesApplicationEvents>
  ) {
    this.eventSource = events;
  }
}
export class RemindersRpcServer implements RpcServer<RemindersRpc> {
  readonly namespace = REMINDERS_RPC;
  readonly streams = {};
  constructor(readonly requests: RemindersApplicationApi) {}
}
export class AnalyticsRpcServer implements RpcServer<AnalyticsRpc> {
  readonly namespace = ANALYTICS_RPC;
  readonly streams = {};
  constructor(readonly requests: AnalyticsApplicationApi) {}
}
