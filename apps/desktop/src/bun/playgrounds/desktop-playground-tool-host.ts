import { McpManager } from "@llm-space/runtime/mcp";
import { inject, injectable } from "inversify";

import { BuiltInTools } from "../tools/built-in-tools";

import {
  PLAYGROUND_TOOL_HOST,
  type PlaygroundToolHost,
} from "./playground-application";

/** Adapts bundled and MCP tools to the Playground's frozen binding seam. */
@injectable()
export class DesktopPlaygroundToolHost implements PlaygroundToolHost {
  constructor(
    @inject(BuiltInTools) private readonly _builtInTools: BuiltInTools,
    @inject(McpManager) private readonly _mcp: McpManager
  ) {}

  /** Snapshot currently available bundled tool definitions. */
  listBuiltinTools() {
    return this._builtInTools.listTools();
  }

  /** Execute one bundled tool through the fixed process-owned bundle. */
  callBuiltinTool: PlaygroundToolHost["callBuiltinTool"] = (input) =>
    this._builtInTools.call(input);

  /** Resolve current tools for one frozen MCP server binding. */
  listMcpTools: PlaygroundToolHost["listMcpTools"] = (serverId) =>
    this._mcp.listTools(serverId);

  /** Execute one MCP tool through the process-owned manager. */
  callMcpTool: PlaygroundToolHost["callMcpTool"] = (input) =>
    this._mcp.callTool(input);
}

export { PLAYGROUND_TOOL_HOST };
