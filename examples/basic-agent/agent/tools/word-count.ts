import { defineTool, toolOutput } from "@llm-space/agent/tools";

export default defineTool({
  description: "Count the words in a piece of text.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to count." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  execute(input) {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    return { count: text.length === 0 ? 0 : text.split(/\s+/u).length };
  },
  toModelOutput(output) {
    return toolOutput.json(output);
  },
});
