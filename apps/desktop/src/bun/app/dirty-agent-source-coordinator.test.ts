import { describe, expect, test } from "bun:test";

import { createDirtyAgentSourceCoordinator } from "./dirty-agent-source-coordinator";

describe("createDirtyAgentSourceCoordinator", () => {
  test("runs clean actions immediately", () => {
    const requests: unknown[] = [];
    let actions = 0;
    const coordinator = createDirtyAgentSourceCoordinator({
      sendRequest: request => { requests.push(request); }
    });

    coordinator.request("reload", () => {
      actions += 1;
    });

    expect(actions).toBe(1);
    expect(requests).toEqual([]);
  });

  test("keeps dirty state after cancel and runs only after confirmation", () => {
    const requests: Array<{ reason: "quit" | "reload"; requestId: string; }> = [];
    let actions = 0;
    const coordinator = createDirtyAgentSourceCoordinator({
      sendRequest: request => { requests.push(request); }
    });
    coordinator.setDirty(true);

    coordinator.request("reload", () => {
      actions += 1;
    });
    coordinator.request("quit", () => {
      actions += 1;
    });
    expect(requests).toHaveLength(1);

    coordinator.resolve(requests[0].requestId, false);
    expect(actions).toBe(0);
    expect(coordinator.dirty).toBe(true);

    coordinator.request("quit", () => {
      actions += 1;
    });
    coordinator.resolve(requests[1].requestId, true);
    expect(actions).toBe(1);
    expect(coordinator.dirty).toBe(false);
  });
});
