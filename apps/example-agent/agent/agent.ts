import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  model: "openai/gpt-5.3-codex",
  reasoning: "high",
  environment: {
    OPENAI_API_KEY: { kind: "secret", required: true }
  }
});
