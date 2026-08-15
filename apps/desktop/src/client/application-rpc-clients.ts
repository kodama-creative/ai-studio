import {
  ANALYTICS_RPC,
  GITHUB_ACCOUNT_RPC,
  REMINDERS_RPC,
  THREAD_SHARING_RPC,
  UPDATES_RPC,
} from "../shared/application-rpc";
import { createRpcClient } from "../shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const transport = createElectrobunRpcClientTransport();
export const threadSharingClient = createRpcClient(
  THREAD_SHARING_RPC,
  transport
);
export const githubAccountClient = createRpcClient(
  GITHUB_ACCOUNT_RPC,
  transport
);
export const updatesClient = createRpcClient(UPDATES_RPC, transport);
export const remindersClient = createRpcClient(REMINDERS_RPC, transport);
export const analyticsClient = createRpcClient(ANALYTICS_RPC, transport);
