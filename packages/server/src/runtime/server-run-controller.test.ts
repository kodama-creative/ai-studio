import {
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import { expect, test } from "bun:test";

import type { CompiledAgentProjectSnapshot } from "@llm-space/runtime/node";

import { ServerRunController } from "./server-run-controller";

import type { ServerPrincipal } from "../auth/server-authenticator";
import type { ServerSessionRepository } from "../repository/server-session-repository";

test("terminalizes a continued Turn when Host capability policy changed", async () => {
  const principal: ServerPrincipal = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user"
  };
  let terminal: { code?: string; outcome: string; } | undefined;
  const repository = {
    findIdempotentRun: async () => Promise.resolve(null),
    authorizedTranscript: () => [],
    createRun: async () => Promise.resolve({
      created: true,
      initiator: principal,
      owner: principal,
      runId: "run-one",
      sessionId: "session-one",
      transcript: [],
      turnSequence: 1
    }),
    load: async () => Promise.resolve({
      version: 1,
      snapshot: {
        schemaVersion: 1,
        id: "session-one",
        activeRunId: "run-one",
        runs: [],
        capabilitySnapshots: {
          "run-one": {
            agentSnapshotFingerprint: "a".repeat(64),
            connectionTools: [],
            fingerprint: "b".repeat(64),
            hostPolicyFingerprint: "previous-policy",
            model: { provider: "fake", id: "fake-model" },
            modelOptions: {},
            requestFingerprint: "previous-request",
            tools: [],
            turnId: "run-one"
          }
        }
      },
      journal: []
    }),
    completeRun: async (input: { code?: string; outcome: string; }) => {
      terminal = input;
    }
  } as unknown as ServerSessionRepository;
  const controller = new ServerRunController({
    models: _models(),
    project: _project(),
    repository
  });

  await controller.createRun({
    continuationToken: "continuation",
    idempotencyKey: "run-one",
    owner: principal,
    sessionId: "session-one",
    text: "continue"
  });
  await controller.waitForIdle();

  expect(terminal).toMatchObject({
    outcome: "failed",
    code: "hostPolicyChanged"
  });
});

test("fails closed when a required Sandbox has no Host provider", () => {
  expect(() => new ServerRunController({
    models: _models(),
    project: {
      ..._project(),
      sandbox: { sourcePath: "sandbox.ts", workspace: [] }
    },
    repository: {} as ServerSessionRepository
  })).toThrow("this Server Host has no SandboxProvider");
});

function _models() {
  const model: Model<"fake"> = {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
  const models = createModels();
  models.setProvider(createProvider({
    id: "fake",
    auth: {
      apiKey: {
        name: "Fake",
        resolve: async () => Promise.resolve({ auth: {} })
      }
    },
    models: [model],
    api: {
      stream: () => { throw new Error("Provider must not run"); },
      streamSimple: () => { throw new Error("Provider must not run"); }
    }
  }));
  return models;
}

function _project(): CompiledAgentProjectSnapshot {
  const fingerprint = "a".repeat(64);
  const section = { fingerprint, entries: [] };
  return {
    artifact: {
      schemaVersion: 1,
      fingerprint,
      fingerprints: {
        sources: section,
        dependencies: section,
        capabilities: section,
        schemas: section,
        runtime: section,
        environmentRequirements: section
      }
    },
    root: "/test-agent",
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Answer briefly.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint
  };
}
