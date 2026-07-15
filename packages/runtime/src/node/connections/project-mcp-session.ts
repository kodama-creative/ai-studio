import { createHash } from "node:crypto";

import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

import type { CompiledMcpConnection } from "../../runtime/agent/agent-project-snapshot";

import {
  RemoteMcpClient,
  type RemoteMcpCallResult,
  type RemoteMcpClientOptions,
} from "./remote-mcp-client";

export interface ProjectMcpRemoteClient {
  listTools(): Promise<McpTool[]>;
  callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RemoteMcpCallResult>;
  close(): Promise<void>;
}

export type ProjectMcpConnector = (
  options: RemoteMcpClientOptions
) => Promise<ProjectMcpRemoteClient>;

export interface ProjectMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly parameters: object;
  readonly sourcePath: string;
  readonly connectionName: string;
  readonly remoteToolName: string;
  readonly schemaFingerprint: string;
}

export type ProjectMcpConnectionStatus =
  | {
      readonly connectionName: string;
      readonly description: string;
      readonly sourcePath: string;
      readonly state: "ready";
      readonly toolNames: readonly string[];
    }
  | {
      readonly connectionName: string;
      readonly description: string;
      readonly sourcePath: string;
      readonly state: "unavailable";
      readonly message: string;
      readonly missingTools?: readonly string[];
    };

interface ActiveTool {
  readonly client: ProjectMcpRemoteClient;
  readonly inputSchema: object;
  readonly remoteToolName: string;
}

export class ProjectMcpSession {
  readonly tools: readonly ProjectMcpToolDescriptor[];
  readonly statuses: readonly ProjectMcpConnectionStatus[];
  private readonly _activeTools: ReadonlyMap<string, ActiveTool>;
  private readonly _clients: readonly ProjectMcpRemoteClient[];

  private constructor(input: {
    tools: ProjectMcpToolDescriptor[];
    statuses: ProjectMcpConnectionStatus[];
    activeTools: Map<string, ActiveTool>;
    clients: ProjectMcpRemoteClient[];
  }) {
    this.tools = Object.freeze(input.tools);
    this.statuses = Object.freeze(input.statuses);
    this._activeTools = input.activeTools;
    this._clients = input.clients;
  }

  static async activate(
    connections: readonly CompiledMcpConnection[],
    options: {
      readonly abortSignal?: AbortSignal;
      readonly connector?: ProjectMcpConnector;
    } = {}
  ): Promise<ProjectMcpSession> {
    const connector =
      options.connector ??
      ((connectionOptions) => RemoteMcpClient.connect(connectionOptions));
    const tools: ProjectMcpToolDescriptor[] = [];
    const statuses: ProjectMcpConnectionStatus[] = [];
    const activeTools = new Map<string, ActiveTool>();
    const clients: ProjectMcpRemoteClient[] = [];
    for (const connection of connections) {
      const activated = await _activateConnection(
        connection,
        connector,
        options.abortSignal
      );
      statuses.push(activated.status);
      if (!activated.client) continue;
      clients.push(activated.client);
      for (const tool of activated.tools) {
        tools.push(tool);
        activeTools.set(tool.name, {
          client: activated.client,
          inputSchema: tool.parameters,
          remoteToolName: tool.remoteToolName,
        });
      }
    }
    return new ProjectMcpSession({ tools, statuses, activeTools, clients });
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RemoteMcpCallResult> {
    const active = this._activeTools.get(name);
    if (!active) throw new Error(`Project MCP tool is unavailable: ${name}`);
    if (!_checkJsonSchema(active.inputSchema, input)) {
      throw new TypeError(`Invalid input for project MCP tool "${name}"`);
    }
    // Deliberately one attempt: tools/call may have completed remotely even
    // when its response is interrupted, so automatic retry is unsafe.
    return await active.client.callTool(active.remoteToolName, input, signal);
  }

  async close(): Promise<void> {
    await Promise.allSettled(this._clients.map((client) => client.close()));
  }
}

function _checkJsonSchema(schema: unknown, value: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;
  const definition = schema as {
    allOf?: unknown[];
    anyOf?: unknown[];
    const?: unknown;
    enum?: unknown[];
    items?: unknown;
    oneOf?: unknown[];
    properties?: Record<string, unknown>;
    required?: string[];
    type?: string | string[];
  };
  if (definition.const !== undefined && value !== definition.const) return false;
  if (definition.enum && !definition.enum.some((item) => item === value)) {
    return false;
  }
  if (definition.allOf?.some((child) => !_checkJsonSchema(child, value))) {
    return false;
  }
  if (
    definition.anyOf &&
    !definition.anyOf.some((child) => _checkJsonSchema(child, value))
  ) {
    return false;
  }
  if (definition.oneOf) {
    if (
      definition.oneOf.filter((child) => _checkJsonSchema(child, value))
        .length !== 1
    ) {
      return false;
    }
  }
  const types = Array.isArray(definition.type)
    ? definition.type
    : definition.type
      ? [definition.type]
      : [];
  if (types.length > 1) {
    return types.some((type) =>
      _checkJsonSchema({ ...definition, type }, value)
    );
  }
  switch (types[0]) {
    case "array":
      return (
        Array.isArray(value) &&
        (!definition.items ||
          value.every((item) => _checkJsonSchema(definition.items, item)))
      );
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }
      const record = value as Record<string, unknown>;
      if (definition.required?.some((key) => !(key in record))) return false;
      return Object.entries(definition.properties ?? {}).every(
        ([key, child]) =>
          !(key in record) || _checkJsonSchema(child, record[key])
      );
    }
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

async function _activateConnection(
  connection: CompiledMcpConnection,
  connector: ProjectMcpConnector,
  abortSignal = new AbortController().signal
): Promise<{
  client?: ProjectMcpRemoteClient;
  tools: ProjectMcpToolDescriptor[];
  status: ProjectMcpConnectionStatus;
}> {
  const { definition } = connection;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let client: ProjectMcpRemoteClient | undefined;
    try {
      const context = {
        abortSignal,
        connectionName: connection.name,
        url: definition.url,
      };
      const headers =
        typeof definition.headers === "function"
          ? await definition.headers(context)
          : { ...(definition.headers ?? {}) };
      const auth = await definition.auth?.(context);
      if (auth) {
        if (!auth.token.trim()) {
          throw new TypeError("Connection auth returned an empty token");
        }
        headers.Authorization = `Bearer ${auth.token}`;
      }
      client = await connector({
        transport: definition.transport,
        url: definition.url,
        headers,
      });
      const available = await client.listTools();
      const byName = new Map(available.map((tool) => [tool.name, tool]));
      const missingTools = definition.tools.allow.filter(
        (name) => !byName.has(name)
      );
      if (missingTools.length > 0) {
        await client.close().catch(() => undefined);
        return {
          tools: [],
          status: {
            connectionName: connection.name,
            description: definition.description,
            sourcePath: connection.logicalPath,
            state: "unavailable",
            message: "One or more allowlisted tools are unavailable.",
            missingTools,
          },
        };
      }
      const tools = definition.tools.allow.map((remoteToolName) => {
        const remote = byName.get(remoteToolName)!;
        return {
          name: `${connection.name}__${remoteToolName}`,
          description: remote.description ?? "",
          parameters: remote.inputSchema,
          sourcePath: connection.logicalPath,
          connectionName: connection.name,
          remoteToolName,
          schemaFingerprint: _schemaFingerprint(remote),
        };
      });
      return {
        client,
        tools,
        status: {
          connectionName: connection.name,
          description: definition.description,
          sourcePath: connection.logicalPath,
          state: "ready",
          toolNames: tools.map((tool) => tool.name),
        },
      };
    } catch (error) {
      await client?.close().catch(() => undefined);
      if (attempt === 0 && _isMetadataAuthError(error)) continue;
      return {
        tools: [],
        status: {
          connectionName: connection.name,
          description: definition.description,
          sourcePath: connection.logicalPath,
          state: "unavailable",
          message: "Unable to connect and load allowlisted tools.",
        },
      };
    }
  }
  throw new Error("Unreachable project MCP activation state");
}

function _schemaFingerprint(tool: McpTool): string {
  const canonical = _canonicalJson({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function _canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${_canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function _isMetadataAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status =
    "status" in error
      ? error.status
      : "code" in error
        ? error.code
        : undefined;
  if (status === 401 || status === 403 || status === "401" || status === "403")
    return true;
  const message = error instanceof Error ? error.message : "";
  return /\b(?:401|403)\b/.test(message);
}
