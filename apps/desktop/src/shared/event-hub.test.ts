import { expect, test } from "bun:test";

import { EventHub } from "./event-hub";

test("EventHub publishes typed values and disposes subscriptions", async () => {
  const hub = new EventHub<{ changed: { id: string } }>();
  const values: string[] = [];
  const subscription = hub.subscribe("changed", ({ id }) => values.push(id));

  hub.publish("changed", { id: "first" });
  await subscription.dispose();
  hub.publish("changed", { id: "second" });
  hub.dispose();

  expect(values).toEqual(["first"]);
});

test("EventHub isolates and reports listener failures", () => {
  const errors: unknown[] = [];
  const values: string[] = [];
  const failure = new Error("listener failed");
  const hub = new EventHub<{ changed: string }>((error) => errors.push(error));
  hub.subscribe("changed", () => {
    throw failure;
  });
  hub.subscribe("changed", (value) => values.push(value));

  hub.publish("changed", "observed");

  expect(errors).toEqual([failure]);
  expect(values).toEqual(["observed"]);
});
