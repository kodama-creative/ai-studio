import { useMemo } from "react";

import { useHostServices } from "../../../host";
import { useGetProviderProfileId } from "../model/provider-profile-selection-provider";

import { createToolExecutor, type ToolExecutor } from "./tool-executor";

export function useToolExecutor(): ToolExecutor | null {
  const { executeTool } = useHostServices();
  const getProfileId = useGetProviderProfileId();
  return useMemo(
    () =>
      executeTool
        ? createToolExecutor({ executeTool, getProfileId })
        : null,
    [executeTool, getProfileId]
  );
}
