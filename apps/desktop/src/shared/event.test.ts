import { describe, expect, test } from "bun:test";

import { Emitter } from "./event";

describe("Emitter", () => {
  test("publishes facts until the subscription is disposed", () => {
    const emitter = new Emitter<number>();
    const received: number[] = [];
    const subscription = emitter.event((value) => received.push(value));

    emitter.fire(1);
    void subscription.dispose();
    emitter.fire(2);

    expect(received).toEqual([1]);
  });

  test("isolates a failing listener from the remaining listeners", () => {
    const errors: unknown[] = [];
    const emitter = new Emitter<string>({
      onListenerError: (error) => errors.push(error),
    });
    const received: string[] = [];
    emitter.event(() => {
      throw new Error("listener failed");
    });
    emitter.event((value) => received.push(value));

    emitter.fire("changed");

    expect(received).toEqual(["changed"]);
    expect(errors).toHaveLength(1);
  });

  test("rejects new subscriptions after disposal", () => {
    const emitter = new Emitter<void>();

    emitter.dispose();

    expect(() => emitter.event(() => undefined)).toThrow(
      "Emitter is disposed."
    );
  });
});
