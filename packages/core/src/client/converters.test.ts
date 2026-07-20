import { expect, test } from "bun:test";

import { convertToPiContext } from "./converters";

test("delivers staged Turn attachments as Pi-native user text", () => {
  const context = convertToPiContext({
    messages: [{
      id: "turn-one",
      role: "user",
      content: [{ type: "text", text: "Inspect the file." }]
    }]
  }, {
    "turn-one": [{
      id: "attachment-one",
      name: "notes.txt",
      path: "/workspace/attachments/turn-one/notes.txt",
      size: 5,
      fingerprint: "a".repeat(64)
    }]
  });

  expect(context.messages[0]?.content).toEqual([
    { type: "text", text: "Inspect the file." },
    {
      type: "text",
      text:
        "<attachments>\n- notes.txt: /workspace/attachments/turn-one/notes.txt\n</attachments>"
    }
  ]);
});
