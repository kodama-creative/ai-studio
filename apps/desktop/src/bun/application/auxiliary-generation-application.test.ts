import { expect, test } from "bun:test";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";

test("generates stateless auxiliary text without creating a Pi Session", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Generated instructions")]);
  const application = new AuxiliaryGenerationApplication({ models });

  const events = [];
  for await (const event of application.generate({
    systemPrompt: "Write concise instructions.",
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "A release assistant" }],
      },
    ],
    model: { provider: model.provider, id: model.id },
  })) {
    events.push(event);
  }

  expect(events.at(-1)).toEqual({
    type: "text.completed",
    text: "Generated instructions",
  });
});
