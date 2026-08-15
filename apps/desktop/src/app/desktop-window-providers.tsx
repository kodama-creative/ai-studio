"use client";

import { ModelProvider } from "@llm-space/ui/components/model-provider";
import { useMemo, type ReactNode } from "react";

import { CommandProvider } from "@/commands";
import {
  createElectrobunModelClient,
  DesktopHostProvider,
} from "@/host/host-services";

/**
 * Owns the renderer capabilities shared by every native Desktop window.
 * Provider ordering is part of this module's interface: the host adapter uses
 * commands, while shared UI reads both host and model clients.
 */
export function DesktopWindowProviders({ children }: { children: ReactNode }) {
  const modelClient = useMemo(() => createElectrobunModelClient(), []);
  return (
    <CommandProvider>
      <DesktopHostProvider>
        <ModelProvider client={modelClient}>{children}</ModelProvider>
      </DesktopHostProvider>
    </CommandProvider>
  );
}
