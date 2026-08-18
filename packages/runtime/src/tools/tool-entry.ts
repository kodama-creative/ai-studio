import type {
  BuiltinTool,
  BuiltinToolCallResponse,
  ProviderConnectionRef,
} from "@llm-space/core";

/** One executable built-in tool definition supplied by the Runtime package. */
export interface BuiltInToolEntry {
  readonly tool: BuiltinTool;
  execute(
    this: void,
    args: Record<string, unknown>,
    config?: Record<string, unknown>,
    context?: BuiltInToolExecutionContext
  ): Promise<unknown>;
}

/** Invocation-only context that must not be persisted with a tool definition. */
export interface BuiltInToolExecutionContext {
  readonly connection?: ProviderConnectionRef;
}

export type ToolCallResponse = BuiltinToolCallResponse;

const STRUCTURED_TOOL_CALL_RESPONSE = Symbol("structuredToolCallResponse");

interface StructuredToolCallResponse extends ToolCallResponse {
  [STRUCTURED_TOOL_CALL_RESPONSE]: true;
}

/**
 * Mark model-facing content explicitly so an ordinary JSON `content` property
 * cannot be mistaken for the built-in tool response contract.
 */
export function createToolCallResponse(
  content: ToolCallResponse["content"]
): ToolCallResponse {
  const response: StructuredToolCallResponse = {
    [STRUCTURED_TOOL_CALL_RESPONSE]: true,
    content,
  };
  return response;
}

/** Normalize an implementation result before it crosses the Desktop RPC seam. */
export function normalizeToolCallResult(result: unknown): ToolCallResponse {
  if (_isToolCallResponse(result)) {
    return { content: result.content };
  }
  return {
    content: [{ type: "text", text: _serializeToolResult(result) }],
  };
}

function _serializeToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
}

function _isToolCallResponse(
  result: unknown
): result is StructuredToolCallResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    STRUCTURED_TOOL_CALL_RESPONSE in result &&
    result[STRUCTURED_TOOL_CALL_RESPONSE] === true
  );
}
