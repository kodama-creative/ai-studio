import { describe, expect, test } from "bun:test";

import type { ModelConfig, ModelProviderGroup } from "@llm-space/core";

import type { ModelClient } from "./types";
import { ModelCatalogController } from "./model-catalog-controller";

describe("ModelCatalogController", () => {
  test("publishes only the current client epoch", async () => {
    const staleModels = _deferred<ModelProviderGroup[]>();
    const staleDefault = _deferred<ModelConfig | null>();
    const clientA = _client({
      availableModels: () => staleModels.promise,
      getDefaultModel: () => staleDefault.promise,
    });
    const clientB = _client({
      availableModels: () => Promise.resolve(_providers("b", "b-model")),
      getDefaultModel: () =>
        Promise.resolve({ provider: "b", id: "b-model" }),
    });
    const controller = new ModelCatalogController(clientA);
    controller.start();
    controller.setClient(clientB);
    await _eventually(
      () => controller.getSnapshot().providers?.[0]?.id,
      "b"
    );

    staleModels.resolve(_providers("a", "a-stale"));
    staleDefault.resolve({ provider: "a", id: "a-stale" });
    await _flushMicrotasks();

    expect(controller.getSnapshot()).toMatchObject({
      client: clientB,
      defaultModel: { provider: "b", id: "b-model" },
      providers: [{ id: "b" }],
    });
    controller.stop();
  });

  test("serializes mutations and makes refresh wait for their side effects", async () => {
    const firstMutation = _deferred<ModelProviderGroup[]>();
    const secondMutation = _deferred<ModelProviderGroup[]>();
    const mutationCalls: boolean[] = [];
    let reads = 0;
    const client = _client({
      availableModels: () => {
        reads += 1;
        return Promise.resolve(_providers("provider", `read-${reads}`));
      },
      setModelEnabled: (_providerId, _modelId, enabled) => {
        mutationCalls.push(enabled);
        return enabled ? secondMutation.promise : firstMutation.promise;
      },
    });
    const controller = new ModelCatalogController(client);
    controller.start();
    await _eventually(() => reads, 1);

    const disable = controller.setModelEnabled("provider", "model", false);
    const enable = controller.setModelEnabled("provider", "model", true);
    const refresh = controller.refresh();
    await _flushMicrotasks();
    expect(mutationCalls).toEqual([false]);
    expect(reads).toBe(1);

    firstMutation.resolve(_providers("provider", "disabled"));
    await _eventually(() => mutationCalls.length, 2);
    expect(mutationCalls).toEqual([false, true]);
    expect(reads).toBe(1);

    secondMutation.resolve(_providers("provider", "enabled"));
    await Promise.all([disable, enable, refresh]);
    expect(reads).toBe(2);
    expect(controller.getSnapshot().providers?.[0]?.models[0]?.id).toBe(
      "read-2"
    );
    controller.stop();
  });

  test("retains a client mutation queue across an A to B to A switch", async () => {
    const mutationMayLand = _deferred<void>();
    let aModelId = "a-old";
    let aReads = 0;
    const clientA = _client({
      availableModels: () => {
        aReads += 1;
        return Promise.resolve(_providers("a", aModelId));
      },
      setModelEnabled: () =>
        mutationMayLand.promise.then(() => {
          aModelId = "a-after-mutation";
          return _providers("a", aModelId);
        }),
    });
    const clientB = _client({
      availableModels: () => Promise.resolve(_providers("b", "b-model")),
    });
    const controller = new ModelCatalogController(clientA);
    controller.start();
    await _eventually(
      () => controller.getSnapshot().providers?.[0]?.models[0]?.id,
      "a-old"
    );

    const mutation = controller.setModelEnabled("a", "a-old", false);
    controller.setClient(clientB);
    await _eventually(
      () => controller.getSnapshot().providers?.[0]?.id,
      "b"
    );
    controller.setClient(clientA);
    await _flushMicrotasks();
    expect(aReads).toBe(1);
    expect(controller.getSnapshot().providers).toEqual([]);

    mutationMayLand.resolve();
    await mutation;
    await _eventually(
      () => controller.getSnapshot().providers?.[0]?.models[0]?.id,
      "a-after-mutation"
    );
    expect(aReads).toBe(2);
    controller.stop();
  });
});

function _client(overrides: Partial<ModelClient> = {}): ModelClient {
  const providers = () => Promise.resolve(_providers("provider", "model"));
  return {
    availableModels: providers,
    builtinProviders: providers,
    getDefaultModel: () => Promise.resolve(null),
    setDefaultModel: (model) => Promise.resolve(model),
    removeProvider: providers,
    addProvider: providers,
    addCustomProvider: providers,
    addProviderProfile: providers,
    updateProviderProfile: providers,
    removeProviderProfile: providers,
    updateProvider: providers,
    setModelEnabled: providers,
    setAllModelsEnabled: providers,
    testModelConnection: () => Promise.resolve(),
    removeCustomModel: providers,
    upsertCustomModel: providers,
    setImageModelEnabled: providers,
    setAllImageModelsEnabled: providers,
    removeCustomImageModel: providers,
    upsertCustomImageModel: providers,
    ...overrides,
  };
}

function _providers(provider: string, modelId: string): ModelProviderGroup[] {
  return [
    {
      id: provider,
      name: provider,
      profiles: [{ id: `${provider}-default`, name: "Default" }],
      models: [
        {
          provider,
          id: modelId,
          name: modelId,
          api: "openai-completions",
          baseUrl: "https://example.com",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 16_384,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  ];
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(read()).toBe(expected);
}

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
