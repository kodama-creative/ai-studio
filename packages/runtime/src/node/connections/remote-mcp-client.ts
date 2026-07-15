import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type CallToolResult,
  CompatibilityCallToolResultSchema,
  type Tool as McpTool
} from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_CHARS = 20_000;

export interface RemoteMcpClientOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RemoteMcpCallResult {
  readonly contentText: string;
  readonly isError: boolean;
}

export class RemoteMcpClient {
  private readonly _client: Client;

  private constructor(client: Client) {
    this._client = client;
  }

  static async connect(options: RemoteMcpClientOptions): Promise<RemoteMcpClient> {
    const client = new Client({ name: "llm-space", version: "1.0.0" });
    const url = new URL(options.url);
    const requestInit =
      Object.keys(options.headers).length > 0
        ? { headers: { ...options.headers } }
        : undefined;
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
      return new RemoteMcpClient(client);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const response = await this._client.listTools(
        cursor ? { cursor } : undefined,
        { timeout: LIST_TIMEOUT_MS }
      );
      tools.push(...response.tools);
      cursor = response.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RemoteMcpCallResult> {
    const result = await this._client.callTool(
      { name, arguments: input },
      CompatibilityCallToolResultSchema,
      { timeout: CALL_TIMEOUT_MS, signal }
    );
    return flattenMcpToolResult(result as CallToolResult);
  }

  async close(): Promise<void> {
    return this._client.close();
  }
}

export function flattenMcpToolResult(
  result: CallToolResult
): RemoteMcpCallResult {
  const parts: string[] = [];
  for (const content of result.content ?? []) {
    if (content.type === "text") {
      parts.push(content.text);
    } else if (content.type === "image" || content.type === "audio") {
      parts.push(
        `[${content.type}: ${content.mimeType}, ${content.data.length} bytes]`
      );
    } else if (content.type === "resource") {
      if ("text" in content.resource) {
        parts.push(`[resource: ${content.resource.uri}]\n${content.resource.text}`);
      } else {
        parts.push(
          `[resource: ${content.resource.uri}, ${content.resource.mimeType ?? "unknown"}, ${content.resource.blob.length} bytes]`
        );
      }
    } else if (content.type === "resource_link") {
      parts.push(`[resource link: ${content.name}] ${content.uri}`);
    }
  }
  if (result.structuredContent) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  const text = parts.join("\n\n").trim();
  return {
    contentText:
      text.length > MAX_OUTPUT_CHARS
        ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated]`
        : text,
    isError: result.isError ?? false
  };
}
