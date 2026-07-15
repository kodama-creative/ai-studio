import { createContext, type ReactNode, useContext } from "react";

import {
  executeTool,
  type ToolExecutor
} from "@/client/tool-execution";

const TOOL_EXECUTION_CONTEXT = createContext<ToolExecutor>(executeTool);

export function ToolExecutionProvider({
  children,
  execute
}: {
  readonly children: ReactNode;
  readonly execute: ToolExecutor;
}) {
  return (
    <TOOL_EXECUTION_CONTEXT.Provider value={execute}>
      {children}
    </TOOL_EXECUTION_CONTEXT.Provider>
  );
}

export function useToolExecutor(): ToolExecutor {
  return useContext(TOOL_EXECUTION_CONTEXT);
}
