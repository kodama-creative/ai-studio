export default {
  name: "get_weather",
  label: "Get weather",
  description: "Return deterministic example weather for a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
  execute(_toolCallId: string, { city }: { city: string }) {
    return Promise.resolve({
      content: [{ type: "text" as const, text: `${city}: Sunny, 22°C` }],
      details: { city, mocked: true },
    });
  },
};
