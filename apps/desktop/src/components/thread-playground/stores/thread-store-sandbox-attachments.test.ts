import { expect, mock, test } from "bun:test";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));

test("keeps staged Sandbox descriptors outside messages and locks them after Run", async () => {
  const { createThreadStore } = await import("./thread-store");
  let finish: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const store = createThreadStore({
    model: { provider: "fake", id: "model" },
    context: {
      messages: [{
        id: "turn-one",
        role: "user",
        content: [{ type: "text", text: "Inspect it." }]
      }]
    }
  }, {
    async* transport() {},
    resolveModel: saved => saved ?? null,
    stageSandboxFiles: async () => {
      await gate;
      return [{
        id: "attachment-one",
        name: "notes.txt",
        path: "/workspace/attachments/batch/notes.txt",
        size: 5,
        fingerprint: "a".repeat(64)
      }];
    }
  });

  const staging = store.getState().addMessageSandboxFiles("turn-one");
  expect(store.getState().stagingSandboxAttachmentMessageIds).toEqual([
    "turn-one"
  ]);
  finish?.();
  await staging;
  expect(store.getState().thread).toMatchObject({
    sandboxAttachments: {
      "turn-one": [{ id: "attachment-one", name: "notes.txt" }]
    }
  });
  expect(store.getState().thread.context?.messages?.[0]).not.toHaveProperty(
    "attachments"
  );

  await store.getState().run();
  expect(store.getState().thread.lockedSandboxAttachmentMessageIds).toEqual([
    "turn-one"
  ]);
  const completedRun = {
    id: "run-one",
    thread: store.getState().thread,
    timestamp: 1
  };
  store.setState({ runHistory: [completedRun] });
  store.getState().removeRun(completedRun);
  expect(store.getState().runHistory).toEqual([]);
  store.getState().removeMessageSandboxAttachment(
    "turn-one",
    "attachment-one"
  );
  expect(store.getState().thread.sandboxAttachments?.["turn-one"]).toHaveLength(1);

  store.getState().removeMessage("turn-one");
  expect(store.getState().thread.sandboxAttachments).toBeUndefined();
});
