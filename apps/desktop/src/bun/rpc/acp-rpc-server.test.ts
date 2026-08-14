import { expect, test } from "bun:test";

import {
  PROTOCOL_VERSION,
  agent,
  client,
  methods,
  type AnyWireMessage,
} from "@llm-space/acp";

import { AcpRpcServer } from "./acp-rpc-server";

test("ACP RPC server preserves official v2 wire messages over its custom envelope", async () => {
  const app = agent({ name: "wire-agent" }).onRequest(
    methods.agent.initialize,
    ({ params }) => ({
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "wire-agent", version: "1" },
      capabilities: {
        sessionCapabilities: {},
        promptCapabilities: {},
        _meta: { echoedClient: params.info?.name },
      },
    })
  );
  const server = new AcpRpcServer(app);
  const connectionId = "connection-1";
  await server.requests.open(connectionId);
  const controller = new AbortController();
  const wire = {
    writable: new WritableStream<AnyWireMessage>({
      write: (message) => server.requests.send(connectionId, message),
    }),
    readable: new ReadableStream<AnyWireMessage>({
      async start(output) {
        for await (const message of server.streams.receive(connectionId, {
          signal: controller.signal,
        })) {
          output.enqueue(message);
        }
        output.close();
      },
      cancel: () => {
        controller.abort();
      },
    }),
  };
  const connection = client({ name: "wire-client" }).connect(wire);
  try {
    const initialized = await connection.agent.request(
      methods.agent.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        info: { name: "wire-client", version: "1" },
      }
    );
    expect(initialized).toMatchObject({
      protocolVersion: 2,
      capabilities: { _meta: { echoedClient: "wire-client" } },
    });
  } finally {
    connection.close();
    controller.abort();
    await server.dispose();
  }
});
