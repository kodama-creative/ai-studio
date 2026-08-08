import { WEB_SEARCH_TOOL_SENTINEL_KIND } from "../shared/types";

export type WebSearchProvider = "exa" | "parallel";
export interface WebSearchToolInput {
  readonly provider: WebSearchProvider;
}
export interface WebSearchToolDefinition extends WebSearchToolInput {
  readonly kind: typeof WEB_SEARCH_TOOL_SENTINEL_KIND;
}

export function webSearch(input: WebSearchToolInput): WebSearchToolDefinition {
  return { kind: WEB_SEARCH_TOOL_SENTINEL_KIND, provider: input.provider };
}
