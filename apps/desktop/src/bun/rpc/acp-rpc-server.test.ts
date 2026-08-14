import { expect, test } from "bun:test";

import {
  PROTOCOL_VERSION,
  agent,
  client,
  methods,
  type AgentConnection,
  type AnyWireMessage,
  type UpdateSessionNotification,
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

test("ACP RPC server routes a selected remote Agent through its host opener", async () => {
  let remoteAgent: AgentConnection | undefined;
  let openedTarget: unknown;
  let resolveUpdate: ((update: UpdateSessionNotification) => void) | undefined;
  const receivedUpdate = new Promise<UpdateSessionNotification>((resolve) => {
    resolveUpdate = resolve;
  });
  const remoteApp = agent({ name: "remote-agent" })
    .onConnect((connection) => {
      remoteAgent = connection;
    })
    .onRequest(methods.agent.session.list, () => ({
      sessions: [{ sessionId: "remote-session", cwd: "/srv/project" }],
    }));
  const localApp = agent({ name: "local-agent" });
  const server = new AcpRpcServer(localApp, (target, onSessionUpdate) => {
    openedTarget = target;
    const connection = client({ name: "desktop-host" })
      .onNotification(methods.client.session.update, ({ params }) =>
        onSessionUpdate(params)
      )
      .connect(remoteApp);
    return Promise.resolve({
      connection,
      initialization: {
        protocolVersion: PROTOCOL_VERSION,
        info: { name: "remote-agent", version: "1" },
        capabilities: {},
      },
      stop: () => {
        connection.close();
        return Promise.resolve();
      },
    });
  });
  const connectionId = "remote-connection";
  await server.requests.open(connectionId, {
    kind: "remote",
    runtimeId: "remote:agent-host",
    projectRoot: "/srv/project",
  });
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
      cancel: () => controller.abort(),
    }),
  };
  const connection = client({ name: "renderer" })
    .onNotification(methods.client.session.update, ({ params }) =>
      resolveUpdate?.(params)
    )
    .connect(wire);
  try {
    expect(
      await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        info: { name: "renderer", version: "1" },
      })
    ).toMatchObject({ info: { name: "remote-agent" } });
    expect(
      await connection.agent.request(methods.agent.session.list, {})
    ).toMatchObject({ sessions: [{ sessionId: "remote-session" }] });
    expect(openedTarget).toEqual({
      kind: "remote",
      runtimeId: "remote:agent-host",
      projectRoot: "/srv/project",
    });
    await remoteAgent?.client.notify(methods.client.session.update, {
      sessionId: "remote-session",
      update: { sessionUpdate: "state_update", state: "idle" },
    });
    expect(await receivedUpdate).toMatchObject({ sessionId: "remote-session" });
  } finally {
    connection.close();
    controller.abort();
    await server.dispose();
  }
});
