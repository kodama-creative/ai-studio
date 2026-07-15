import { createContext, useContext, type ReactNode } from "react";

import {
  executeTool,
  type ToolExecutor,
} from "@/client/tool-execution";

const ToolExecutionContext = createContext<ToolExecutor>(executeTool);

export function ToolExecutionProvider({
  children,
  execute,
}: {
  children: ReactNode;
  execute: ToolExecutor;
}) {
  return (
    <ToolExecutionContext.Provider value={execute}>
      {children}
    </ToolExecutionContext.Provider>
  );
}

export function useToolExecutor(): ToolExecutor {
  return useContext(ToolExecutionContext);
}
