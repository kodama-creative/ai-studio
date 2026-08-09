import { homedir } from "node:os";
import { join } from "node:path";

import { createModels, type Models } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { loadAgent } from "@llm-space/agent/loader";
import { createHarness, type HarnessSessionSnapshot } from "@llm-space/harness";
import { createFileSessionStorage } from "@llm-space/harness/storage/file";
import { createPiModelTurnEngine } from "@llm-space/harness-pi";

import { ExampleFauxModel } from "./example-faux-model";
import { renderSessionTurn } from "./session-event-renderer";

const DEFAULT_STORAGE_ROOT = join(
  process.env.LLM_SPACE_HOME ?? join(homedir(), ".llm-space"),
  "harness",
  "basic-agent"
);

export interface CreateBasicAgentLocalHostOptions {
  readonly sessionId?: string;
  readonly storageRoot?: string;
  readonly write?: (value: string) => void;
  readonly models?: Models;
}

export interface BasicAgentLocalHost {
  readonly sessionId: string;
  send(message: string): Promise<HarnessSessionSnapshot>;
  cancel(): Promise<void>;
  snapshot(): Promise<HarnessSessionSnapshot>;
}

export async function createBasicAgentLocalHost(
  options: CreateBasicAgentLocalHostOptions = {}
): Promise<BasicAgentLocalHost> {
  const localModels =
    options.models === undefined
      ? _createLocalModels()
      : { models: options.models, faux: undefined };
  const storageRoot = options.storageRoot ?? DEFAULT_STORAGE_ROOT;
  const storage = createFileSessionStorage(storageRoot);
  const generation = await loadAgent({ startPath: import.meta.dir });
  const harness = createHarness({
    commandQueue: storage.commandQueue,
    engine: createPiModelTurnEngine({ models: localModels.models }),
    repository: storage.repository,
    eventLog: storage.eventLog,
    runRepository: storage.runRepository,
  });
  const agent = await harness.prepare(generation);
  const session =
    options.sessionId === undefined
      ? await agent.createSession()
      : await agent.attachSession(options.sessionId);
  if (session === undefined) {
    throw new Error(`Session "${options.sessionId}" was not found.`);
  }
  if ((await session.snapshot()).status === "running") await session.cancel();

  return {
    sessionId: session.id,
    async send(message) {
      if (message.trim().length === 0) {
        throw new Error("Message must not be empty.");
      }
      localModels.faux?.queueTurn();
      const before = await session.snapshot();
      await Promise.all([
        session.send({ message }),
        renderSessionTurn(
          session,
          before.eventSequence,
          options.write ?? (() => undefined)
        ),
      ]);
      return session.snapshot();
    },
    cancel: () => session.cancel(),
    snapshot: () => session.snapshot(),
  };
}

function _createLocalModels(): {
  readonly models: Models;
  readonly faux: ExampleFauxModel;
} {
  const models = createModels();
  const faux = new ExampleFauxModel();
  models.setProvider(faux.provider.provider);
  models.setProvider(openaiProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(googleProvider());
  models.setProvider(openrouterProvider());
  return { models, faux };
}
