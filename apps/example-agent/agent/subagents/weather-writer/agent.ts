import { defineAgent } from "@llm-space/runtime";

export default defineAgent({
  description: "Turn bounded weather facts into a concise simulated forecast.",
  model: "openai/gpt-5.3-codex",
  reasoning: "medium"
});
