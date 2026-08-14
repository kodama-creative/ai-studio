import {
  PROTOCOL_VERSION,
  client,
  methods,
  type AnyWireMessage,
  type ClientConnection,
  type UpdateSessionNotification,
} from "@llm-space/acp";

import { ACP_RPC, type AcpRpc } from "../shared/acp-rpc";
import { createRpcClientProxy, type RpcClient } from "../shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export interface OpenDesktopAcpConnectionOptions {
  readonly onSessionUpdate?: (update: UpdateSessionNotification) => void;
}

/** Opens one official ACP v2 client over the Electrobun custom wire stream. */
export async function openDesktopAcpConnection(
  options: OpenDesktopAcpConnectionOptions = {}
): Promise<ClientConnection> {
  const rpc: RpcClient<AcpRpc> = createRpcClientProxy(
    ACP_RPC,
    createElectrobunRpcClientTransport()
  );
  const connectionId = crypto.randomUUID();
  await rpc.open(connectionId);
  const controller = new AbortController();
  const wire = {
    writable: new WritableStream<AnyWireMessage>({
      write: (message) => rpc.send(connectionId, message),
      close: () => rpc.close(connectionId),
      abort: () => rpc.close(connectionId),
    }),
    readable: new ReadableStream<AnyWireMessage>({
      async start(streamController) {
        try {
          for await (const message of rpc.receive(connectionId, {
            signal: controller.signal,
          })) {
            streamController.enqueue(message);
          }
          streamController.close();
        } catch (error) {
          streamController.error(error);
        }
      },
      cancel() {
        controller.abort();
        return rpc.close(connectionId);
      },
    }),
  };
  const app = client({ name: "llm-space-desktop" }).onNotification(
    methods.client.session.update,
    ({ params }) => options.onSessionUpdate?.(params)
  );
  const connection = app.connect(wire);
  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    info: { name: "llm-space-desktop", version: "1" },
  });
  return connection;
}
