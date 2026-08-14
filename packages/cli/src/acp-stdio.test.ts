import { expect, test } from "bun:test";

import {
  PROTOCOL_VERSION,
  agent,
  client,
  methods,
  ndJsonStream,
} from "@llm-space/acp";

import { serveAcpStdio } from "./acp-stdio";

test("serves official ACP v2 messages over NDJSON byte streams", async () => {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const app = agent({ name: "stdio-test-agent" }).onRequest(
    methods.agent.initialize,
    ({ params }) => ({
      protocolVersion: params.protocolVersion,
      info: { name: "stdio-test-agent", version: "1" },
      capabilities: {},
    })
  );
  const serving = serveAcpStdio(app, {
    input: clientToAgent.readable,
    output: agentToClient.writable,
  });
  const connection = client({ name: "stdio-test-client" }).connect(
    ndJsonStream(clientToAgent.writable, agentToClient.readable)
  );
  const response = await connection.agent.request(
    methods.agent.initialize,
    {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "stdio-test-client", version: "1" },
    }
  );
  expect(response).toMatchObject({
    protocolVersion: PROTOCOL_VERSION,
    info: { name: "stdio-test-agent" },
  });
  connection.close();
  // A real stdio peer closes its stdout when the process exits. Closing the
  // test transport explicitly reproduces that EOF so the server can finish.
  await clientToAgent.writable.close();
  await serving;
});

test("closes immediately when stdio serving starts already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop before connect"));
  const app = agent({ name: "aborted-stdio-agent" });

  await serveAcpStdio(app, {
    input: new ReadableStream<Uint8Array>(),
    output: new WritableStream<Uint8Array>(),
    signal: controller.signal,
  });
});
