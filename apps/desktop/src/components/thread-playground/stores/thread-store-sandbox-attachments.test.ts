import { expect, mock, test } from "bun:test";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));

test("locks a staged Sandbox attachment descriptor into its user Turn", async () => {
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
  expect(store.getState().thread.context?.messages?.[0]).toMatchObject({
    attachments: [{ id: "attachment-one", name: "notes.txt" }]
  });

  store.setState({ status: "running" });
  store.getState().removeMessageSandboxAttachment(
    "turn-one",
    "attachment-one"
  );
  expect(store.getState().thread.context?.messages?.[0]).toHaveProperty(
    "attachments"
  );
});
