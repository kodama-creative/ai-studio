import { describe, expect, test } from "bun:test";

import type { ModelCatalogController } from "@llm-space/ui/host";

import type { ModelsRpc } from "@/shared/models-rpc";
import type { RpcClient } from "@/shared/namespaced-rpc";

import { ModelsChangeController } from "./models-change-controller";

describe("ModelsChangeController", () => {
  test("refreshes for committed remote changes and releases its subscription", () => {
    let listener: (() => void) | undefined;
    let refreshes = 0;
    let disposals = 0;
    const models = {
      on: (_event: "changed", next: () => void) => {
        listener = next;
        return {
          dispose: () => {
            disposals += 1;
            listener = undefined;
          },
        };
      },
    } as RpcClient<ModelsRpc>;
    const catalog = {
      refresh: () => {
        refreshes += 1;
        return Promise.resolve();
      },
    } as unknown as ModelCatalogController;
    const controller = new ModelsChangeController(models, catalog);

    controller.start();
    controller.start();
    listener?.();
    expect(refreshes).toBe(1);

    controller.stop();
    expect(disposals).toBe(1);
    expect(listener).toBeUndefined();

    controller.start();
    listener?.();
    expect(refreshes).toBe(2);
  });
});
