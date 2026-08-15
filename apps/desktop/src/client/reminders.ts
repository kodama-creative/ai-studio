import { createRpcClient } from "@/shared/namespaced-rpc";
import { REMINDERS_RPC } from "@/shared/reminders-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Renderer client owned by the Reminders RPC feature. */
export const remindersClient = createRpcClient(
  REMINDERS_RPC,
  createElectrobunRpcClientTransport()
);
