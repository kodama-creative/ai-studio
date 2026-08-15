import { describe, expect, test } from "bun:test";

import type { AgentProjectsEvents } from "@/shared/agent-project-rpc";
import { EventHub } from "@/shared/event-hub";

import {
  AgentProjectCatalogController,
  type AgentProjectCatalogControllerOptions,
} from "./agent-project-catalog-controller";

describe("AgentProjectCatalogController", () => {
  test("subscribes before reading and keeps the newest changed-event result", async () => {
    const events = new EventHub<AgentProjectsEvents>();
    const initial = _deferred<readonly ReturnType<typeof _project>[]>();
    const order: string[] = [];
    let reads = 0;
    const errors: string[] = [];
    const client: AgentProjectCatalogControllerOptions["client"] = {
      list: () => {
        reads += 1;
        order.push(`list:${reads}`);
        return reads === 1
          ? initial.promise
          : Promise.resolve([_project("latest")]);
      },
      on: (event, listener) => {
        order.push(`subscribe:${event}`);
        return events.subscribe(event, listener);
      },
    };
    const controller = new AgentProjectCatalogController({
      client,
      reportError: (title, error) =>
        errors.push(`${title}:${String(error)}`),
    });

    controller.start();
    expect(order).toEqual([
      "subscribe:changed",
      "subscribe:openFailed",
      "list:1",
    ]);

    events.publish("changed", {});
    await _eventually(
      () => controller.getSnapshot().projects[0]?.id,
      "latest"
    );
    initial.resolve([_project("stale")]);
    await Promise.resolve();
    expect(controller.getSnapshot().projects[0]?.id).toBe("latest");

    events.publish("openFailed", { message: "not an Agent Project" });
    expect(errors).toEqual([
      "Unable to open Agent Project:Error: not an Agent Project",
    ]);

    controller.stop();
    events.publish("changed", {});
    await Promise.resolve();
    expect(reads).toBe(2);
  });

  test("ignores a list response completed after stop", async () => {
    const events = new EventHub<AgentProjectsEvents>();
    const pending = _deferred<readonly ReturnType<typeof _project>[]>();
    const controller = new AgentProjectCatalogController({
      client: {
        list: () => pending.promise,
        on: (event, listener) => events.subscribe(event, listener),
      },
      reportError: (title, error) => {
        throw new Error(`${title}: ${String(error)}`);
      },
    });

    controller.start();
    controller.stop();
    pending.resolve([_project("late")]);
    await Promise.resolve();

    expect(controller.getSnapshot().projects).toEqual([]);
  });

  test("ignores callbacks retained by an asynchronously disposed lifecycle", async () => {
    const retained = new Map<string, (...args: never[]) => void>();
    let reads = 0;
    const errors: string[] = [];
    const controller = new AgentProjectCatalogController({
      client: {
        list: () => {
          reads += 1;
          return Promise.resolve([_project(`read-${reads}`)]);
        },
        on: (event, listener) => {
          retained.set(event, listener);
          return { dispose: () => Promise.resolve() };
        },
      },
      reportError: (title) => errors.push(title),
    });

    controller.start();
    const staleChanged = retained.get("changed")!;
    const staleOpenFailed = retained.get("openFailed")!;
    controller.stop();
    controller.start();
    await _eventually(() => controller.getSnapshot().loading, false);

    staleChanged();
    staleOpenFailed({ message: "stale" } as never);
    await Promise.resolve();

    expect(reads).toBe(2);
    expect(errors).toEqual([]);
  });

  test("cleans up earlier subscriptions when a later subscription fails", () => {
    const disposed: string[] = [];
    const errors: string[] = [];
    const controller = new AgentProjectCatalogController({
      client: {
        list: () => Promise.resolve([]),
        on: (event) => {
          if (event === "openFailed") throw new Error("subscribe failed");
          return {
            dispose: () => {
              disposed.push(event);
            },
          };
        },
      },
      reportError: (title, error) =>
        errors.push(`${title}:${String(error)}`),
    });

    controller.start();

    expect(disposed).toEqual(["changed"]);
    expect(controller.getSnapshot().loading).toBe(false);
    expect(errors).toEqual([
      "Unable to watch Agent Projects:Error: subscribe failed",
    ]);
  });
});

function _project(id: string) {
  return {
    id,
    name: id,
    rootPath: `/projects/${id}`,
  };
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (read() === expected) return;
    await Promise.resolve();
  }
  expect(read()).toBe(expected);
}
