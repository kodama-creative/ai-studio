import { defineAgent } from "@llm-space/agent";

export default defineAgent({
  model: process.env.LLM_SPACE_MODEL ?? "faux/local",
});
