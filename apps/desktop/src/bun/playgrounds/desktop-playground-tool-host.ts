import { McpManager } from "@llm-space/runtime/mcp";
import { inject, injectable } from "inversify";

import { DesktopHost } from "../host/desktop-host";

import {
  PLAYGROUND_TOOL_HOST,
  type PlaygroundToolHost,
} from "./playground-application";

/** Adapts bundled and MCP tools to the Playground's frozen binding seam. */
@injectable()
export class DesktopPlaygroundToolHost implements PlaygroundToolHost {
  constructor(
    @inject(DesktopHost) private readonly _desktop: DesktopHost,
    @inject(McpManager) private readonly _mcp: McpManager
  ) {}

  /** Snapshot currently available bundled tool definitions. */
  listBuiltinTools() {
    return this._desktop.tools.listTools();
  }

  /** Execute one bundled tool through the process-owned registry. */
  callBuiltinTool: PlaygroundToolHost["callBuiltinTool"] = (input) =>
    this._desktop.tools.call(input);

  /** Resolve current tools for one frozen MCP server binding. */
  listMcpTools: PlaygroundToolHost["listMcpTools"] = (serverId) =>
    this._mcp.listTools(serverId);

  /** Execute one MCP tool through the process-owned manager. */
  callMcpTool: PlaygroundToolHost["callMcpTool"] = (input) =>
    this._mcp.callTool(input);
}

export { PLAYGROUND_TOOL_HOST };
