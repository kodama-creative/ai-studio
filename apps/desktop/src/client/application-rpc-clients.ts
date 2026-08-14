import {
  ANALYTICS_RPC,
  GITHUB_ACCOUNT_RPC,
  REMINDERS_RPC,
  THREAD_SHARING_RPC,
  UPDATES_RPC,
} from "../shared/application-rpc";
import { createRpcClientProxy } from "../shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const transport = createElectrobunRpcClientTransport();
export const threadSharingClient = createRpcClientProxy(
  THREAD_SHARING_RPC,
  transport
);
export const githubAccountClient = createRpcClientProxy(
  GITHUB_ACCOUNT_RPC,
  transport
);
export const updatesClient = createRpcClientProxy(UPDATES_RPC, transport);
export const remindersClient = createRpcClientProxy(REMINDERS_RPC, transport);
export const analyticsClient = createRpcClientProxy(ANALYTICS_RPC, transport);
