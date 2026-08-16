import { describe, expect, test } from "bun:test";

import { FinalControllerDisposal } from "./use-final-controller-disposal";

describe("FinalControllerDisposal", () => {
  test("keeps the controller alive across a StrictMode effect replay", async () => {
    let closes = 0;
    const disposal = new FinalControllerDisposal(() => {
      closes += 1;
    });

    const detachProbe = disposal.attach();
    detachProbe();
    const detachCommittedMount = disposal.attach();
    await Promise.resolve();

    expect(closes).toBe(0);

    detachCommittedMount();
    await Promise.resolve();

    expect(closes).toBe(1);
  });

  test("ignores duplicate cleanup and disposes at most once", async () => {
    let closes = 0;
    const disposal = new FinalControllerDisposal(() => {
      closes += 1;
    });
    const detach = disposal.attach();

    detach();
    detach();
    await Promise.resolve();

    expect(closes).toBe(1);
  });
});
