import { describe, expect, test } from "bun:test";

import {
  prepareShareThreadDialogCommit,
  ShareThreadDialogFlow,
} from "./share-thread-dialog-flow";

describe("ShareThreadDialogFlow", () => {
  test("applies a rendered target only when its commit is accepted", () => {
    const flow = new ShareThreadDialogFlow();
    const commit = prepareShareThreadDialogCommit(true, {
      path: "playgrounds/alpha",
    });

    expect(
      flow.createTransaction({ title: "ignored", description: "" })
    ).toBeNull();

    commit.commit(flow);

    expect(
      flow.createTransaction({ title: "  Alpha  ", description: " note " })
    ).toEqual({
      id: 1,
      path: "playgrounds/alpha",
      title: "Alpha",
      description: "note",
    });
  });

  test("does not display a title read for an obsolete target", async () => {
    const flow = new ShareThreadDialogFlow();
    const read = _deferred<{ title: string }>();
    const displayed: string[] = [];
    flow.sync(true, { path: "playgrounds/alpha" });

    const prefill = flow.prefillTitle(() => read.promise, (title) =>
      displayed.push(title)
    );
    flow.sync(true, { path: "playgrounds/beta" });
    read.resolve({ title: "Alpha" });
    await prefill;

    expect(displayed).toEqual([]);
  });

  test("does not publish success after close and same-target reopen", async () => {
    const flow = new ShareThreadDialogFlow();
    const published = _deferred<{ shareUrl: string }>();
    const callbacks: string[] = [];
    flow.sync(true, { path: "playgrounds/alpha" });
    const transaction = flow.createTransaction({
      title: "Alpha",
      description: "",
    })!;

    const publish = flow.publish(transaction, () => published.promise, {
      onStart: () => callbacks.push("start"),
      onSuccess: () => callbacks.push("success"),
      onError: () => callbacks.push("error"),
    });
    flow.invalidate();
    flow.sync(true, { path: "playgrounds/alpha" });
    published.resolve({ shareUrl: "https://example.test/shared" });
    await publish;

    expect(callbacks).toEqual(["start"]);
  });

  test("resumes completed auth and reports a cancelled device flow", () => {
    const flow = new ShareThreadDialogFlow();
    flow.sync(true, { path: "playgrounds/alpha" });
    const first = flow.createTransaction({ title: "", description: "" })!;
    expect(flow.beginAuth(first)).toBe(true);
    expect(flow.observeAuth("signedOut")).toEqual({ type: "none" });
    expect(flow.observeAuth("signingIn")).toEqual({ type: "none" });
    expect(flow.observeAuth("signedOut")).toEqual({ type: "cancelled" });

    const second = flow.createTransaction({ title: "", description: "" })!;
    expect(flow.beginAuth(second)).toBe(true);
    expect(flow.observeAuth("signedIn")).toEqual({
      type: "resume",
      transaction: second,
    });
    expect(flow.observeAuth("signedIn")).toEqual({ type: "none" });
  });

  test("reports only a current publish failure", async () => {
    const flow = new ShareThreadDialogFlow();
    const failure = new Error("rate limit");
    const errors: unknown[] = [];
    flow.sync(true, { path: "playgrounds/alpha" });
    const transaction = flow.createTransaction({
      title: "",
      description: "",
    })!;

    await flow.publish(transaction, () => Promise.reject(failure), {
      onStart: () => undefined,
      onSuccess: () => undefined,
      onError: (error) => errors.push(error),
    });

    expect(errors).toEqual([failure]);
  });
});

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
