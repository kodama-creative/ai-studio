import { homedir } from "node:os";
import { join } from "node:path";

import { createModels, type Models } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { loadAgent } from "@llm-space/agent/loader";
import type { ToolContext } from "@llm-space/agent/tools";
import { createSessionApplication, type Session } from "@llm-space/app";
import { createSqliteApplicationStore } from "@llm-space/app/storage/sqlite";
import type { Message } from "@llm-space/core";
import {
  createAgentEngine,
  executableAgent,
  resolveAgentGeneration,
  type AgentEngine,
  type Run,
} from "@llm-space/engine";
import { createSqliteEngineStore } from "@llm-space/engine/storage/sqlite";
import { createPiModelTurnDriver } from "@llm-space/engine-pi";

import { ExampleFauxModel } from "./example-faux-model";
import { renderRun } from "./session-event-renderer";

const DEFAULT_STORAGE_ROOT = join(
  process.env.LLM_SPACE_HOME ?? join(homedir(), ".llm-space"),
  "engine",
  "basic-agent"
);

export interface BasicAgentSessionSnapshot {
  readonly id: string;
  readonly status: "waiting" | "running";
  readonly messages: readonly Message[];
}

export interface CreateBasicAgentLocalHostOptions {
  readonly sessionId?: string;
  readonly storageRoot?: string;
  readonly write?: (value: string) => void;
  readonly models?: Models;
}

export interface BasicAgentLocalHost {
  readonly sessionId: string;
  send(message: string): Promise<BasicAgentSessionSnapshot>;
  cancel(): Promise<void>;
  snapshot(): Promise<BasicAgentSessionSnapshot>;
  close(): Promise<void>;
}

export async function createBasicAgentLocalHost(
  options: CreateBasicAgentLocalHostOptions = {}
): Promise<BasicAgentLocalHost> {
  const localModels =
    options.models === undefined
      ? _createLocalModels()
      : { models: options.models, faux: undefined };
  const storageRoot = options.storageRoot ?? DEFAULT_STORAGE_ROOT;
  const databasePath = join(storageRoot, "basic-agent.sqlite");
  const prepared = await resolveAgentGeneration(
    await loadAgent({ startPath: import.meta.dir })
  );
  const executable = executableAgent(prepared);
  const engineStore = createSqliteEngineStore({ path: databasePath });
  let engine: AgentEngine;
  try {
    engine = createAgentEngine({
      store: engineStore,
      modelDriver: createPiModelTurnDriver({ models: localModels.models }),
      agentResolver: {
        resolve(snapshot) {
          if (
            snapshot.agentId !== executable.snapshot.agentId ||
            snapshot.generationId !== executable.snapshot.generationId
          ) {
            throw new Error(
              `Agent generation "${snapshot.agentId}/${snapshot.generationId}" is unavailable.`
            );
          }
          return Promise.resolve(executable);
        },
      },
      createToolContext: _toolContext,
    });
  } catch (error) {
    engineStore.close();
    throw error;
  }
  let applicationStore: ReturnType<typeof createSqliteApplicationStore>;
  try {
    applicationStore = createSqliteApplicationStore({ path: databasePath });
  } catch (error) {
    await engine.close();
    throw error;
  }
  let application: ReturnType<typeof createSessionApplication>;
  try {
    application = createSessionApplication({
      engine,
      store: applicationStore,
    });
  } catch (error) {
    applicationStore.close();
    await engine.close();
    throw error;
  }
  let session: Session;
  try {
    session = await _resolveSession(
      application,
      options.sessionId,
      executable.snapshot.agentId
    );
  } catch (error) {
    await application.close();
    throw error;
  }
  let activeRunId: string | undefined;

  const snapshot = async (): Promise<BasicAgentSessionSnapshot> => {
    const current = await application.getSession(session.id);
    if (current === undefined)
      throw new Error(`Session "${session.id}" was not found.`);
    const active = (await application.listRuns(current.id)).find(_isActiveRun);
    const messages = (await application.listMessages(current.id)).flatMap(
      (item) => (item.type === "model" ? [item.message] : [])
    );
    return {
      id: current.id,
      status: active === undefined ? "waiting" : "running",
      messages,
    };
  };

  return {
    sessionId: session.id,
    async send(message) {
      if (message.trim().length === 0)
        throw new Error("Message must not be empty.");
      localModels.faux?.queueTurn();
      const run = await application.startRun({
        sessionId: session.id,
        message: {
          id: `message_${crypto.randomUUID().replaceAll("-", "")}`,
          role: "user",
          content: [{ type: "text", text: message }],
        },
        agentSnapshot: executable.snapshot,
      });
      activeRunId = run.id;
      try {
        await renderRun(
          application.streamRun(session.id, run.id, { follow: true }),
          options.write ?? (() => undefined)
        );
      } finally {
        activeRunId = undefined;
      }
      return snapshot();
    },
    cancel: () =>
      activeRunId === undefined
        ? Promise.resolve()
        : application.cancelRun(session.id, activeRunId),
    snapshot,
    close: () => application.close(),
  };
}

async function _resolveSession(
  application: ReturnType<typeof createSessionApplication>,
  sessionId: string | undefined,
  agentId: string
): Promise<Session> {
  if (sessionId === undefined) return application.createSession({ agentId });
  const session = await application.getSession(sessionId);
  if (session === undefined)
    throw new Error(`Session "${sessionId}" was not found.`);
  for (const run of await application.listRuns(session.id)) {
    if (_isActiveRun(run)) await application.cancelRun(session.id, run.id);
  }
  return session;
}

function _toolContext(input: {
  readonly execution: ToolContext["execution"];
  readonly signal: AbortSignal;
}): ToolContext {
  return {
    execution: input.execution,
    abortSignal: input.signal,
    getSandbox() {
      throw new Error("The basic Agent example does not provide a sandbox.");
    },
    getSkill(identifier: string) {
      throw new Error(
        `The basic Agent example cannot resolve skill "${identifier}".`
      );
    },
    getToken() {
      return Promise.reject(
        new Error("The basic Agent example does not provide connection tokens.")
      );
    },
    requireAuth() {
      throw new Error("The basic Agent example cannot request authorization.");
    },
  };
}

function _isActiveRun(run: Run): boolean {
  return run.status === "queued" || run.status === "running";
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
