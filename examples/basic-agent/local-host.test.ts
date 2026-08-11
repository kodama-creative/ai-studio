import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";

import {
  createBasicAgentLocalHost,
  type BasicAgentLocalHost,
} from "./local-host";

const ROOTS: string[] = [];
const HOSTS: BasicAgentLocalHost[] = [];
const ORIGINAL_MODEL = process.env.LLM_SPACE_MODEL;

beforeAll(() => {
  process.env.LLM_SPACE_MODEL = "faux/local";
});

afterAll(() => {
  if (ORIGINAL_MODEL === undefined) delete process.env.LLM_SPACE_MODEL;
  else process.env.LLM_SPACE_MODEL = ORIGINAL_MODEL;
});

afterEach(async () => {
  await Promise.all(HOSTS.splice(0).map((host) => host.close()));
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("basic agent runs locally with Pi and reattaches its persisted session", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "llm-space-basic-agent-"));
  ROOTS.push(storageRoot);
  let output = "";
  const first = await _host({
    storageRoot,
    write: (value) => {
      output += value;
    },
  });

  const completed = await first.send("hello local agent");

  expect(output).toBe("The message contains 3 words.");
  expect(completed).toMatchObject({
    id: first.sessionId,
    status: "waiting",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello local agent" }],
      },
      {
        role: "assistant",
        toolCalls: [
          {
            input: { name: "word-count" },
            output: {
              content: [{ type: "text", text: '{"count":3}' }],
              isError: false,
            },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The message contains 3 words." }],
      },
    ],
  });

  await first.close();
  const restored = await _host({
    storageRoot,
    sessionId: first.sessionId,
  });
  expect(await restored.snapshot()).toEqual(completed);
});

test("basic agent cancellation aborts Pi and persists a waiting session", async () => {
  const storageRoot = await mkdtemp(
    join(tmpdir(), "llm-space-basic-agent-cancel-")
  );
  ROOTS.push(storageRoot);
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "local" }],
    tokensPerSecond: 20,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses([
    fauxAssistantMessage(
      "This response is deliberately long enough to cancel."
    ),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  let observedDelta!: () => void;
  const firstDelta = new Promise<void>((resolve) => {
    observedDelta = resolve;
  });
  const host = await _host({
    storageRoot,
    models,
    write: () => observedDelta(),
  });

  const sending = host.send("cancel this turn");
  await firstDelta;
  await host.cancel();
  await sending;

  expect(await host.snapshot()).toMatchObject({ status: "waiting" });
  await host.close();
  const restored = await _host({
    storageRoot,
    sessionId: host.sessionId,
    models,
  });
  expect(await restored.snapshot()).toMatchObject({ status: "waiting" });
});

async function _host(
  options: Parameters<typeof createBasicAgentLocalHost>[0]
): Promise<BasicAgentLocalHost> {
  const host = await createBasicAgentLocalHost(options);
  HOSTS.push(host);
  return host;
}
