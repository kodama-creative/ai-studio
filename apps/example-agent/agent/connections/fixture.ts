import { defineMcpClientConnection } from "@llm-space/runtime/connections";

export default defineMcpClientConnection({
  url: "http://127.0.0.1:8765/mcp",
  description: "Deterministic local MCP fixture for portable action checks.",
  tools: { allow: ["remote_echo"] }
});
