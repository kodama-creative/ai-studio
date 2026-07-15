#!/usr/bin/env bun
// Intentionally preserved as durable kaizen evidence: this fixture reproduces
// remote Streamable HTTP MCP setup states without real third-party services
// or secrets, so future reviews can rerun the Remote MCP Diagnostics V1 matrix.
import { McpServer } from "../../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { createMcpExpressApp } from "../../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/server/express.js";
import { StreamableHTTPServerTransport } from "../../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 8765);
const MODE = process.env.MODE ?? "success";
const CALL_DELAY_MS = Number(process.env.CALL_DELAY_MS ?? 0);

/**
 * Creates one MCP server instance with a single echo tool. Each request gets a
 * fresh instance so transport/session cleanup stays isolated between cases.
 */
function _createServer() {
  const server = new McpServer({
    name: "llm-space-remote-fixture",
    version: "1.0.0",
  });
  server.registerTool(
    "remote_echo",
    {
      description:
        "Echoes a fixture response for remote MCP diagnostics." +
        (process.env.DESCRIPTION_SUFFIX ?? ""),
      inputSchema: {},
    },
    async () => {
      if (CALL_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, CALL_DELAY_MS));
      }
      return {
        content: [{ type: "text", text: "remote fixture ok" }],
      };
    }
  );
  return server;
}

const app = createMcpExpressApp();

app.use((req, res, next) => {
  if (MODE !== "auth" && MODE !== "forbidden") {
    next();
    return;
  }
  if (req.header("authorization") === "Bearer fixture-token") {
    next();
    return;
  }
  res.setHeader("www-authenticate", "Bearer");
  res.status(MODE === "forbidden" ? 403 : 401).send("Unauthorized");
});

if (MODE === "timeout") {
  app.all("/mcp", async () => {
    await new Promise(() => {});
  });
} else if (MODE === "notFound") {
  app.all("/mcp", (_req, res) => {
    res.status(404).send("Not found");
  });
} else if (MODE === "malformed") {
  app.all("/mcp", (_req, res) => {
    res.status(200).type("text/plain").send("not an MCP response");
  });
} else {
  app.post("/mcp", async (req, res) => {
    const server = _createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  });
  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
}

app.listen(PORT, (error) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(
    `Remote MCP fixture listening on http://127.0.0.1:${PORT}/mcp (Streamable HTTP, ${MODE})`
  );
});
