import type { BuiltinTool } from "@llm-space/core";

export type BuiltInToolCategoryId = "fileSystem" | "misc" | "web";

export interface BuiltInToolGroup {
  id: BuiltInToolCategoryId;
  label: string;
  tools: BuiltinTool[];
}
