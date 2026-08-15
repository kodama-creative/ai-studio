"use client";

import { ModelProvider } from "@llm-space/ui/components/model-provider";
import type { ModelClient } from "@llm-space/ui/host";
import { useMemo, type ReactNode } from "react";

/** Supplies a window-local Models RPC client to shared renderer components. */
export function DesktopModelProvider({
  children,
  createClient,
}: {
  children: ReactNode;
  createClient: () => ModelClient;
}) {
  const client = useMemo(() => createClient(), [createClient]);
  return <ModelProvider client={client}>{children}</ModelProvider>;
}
