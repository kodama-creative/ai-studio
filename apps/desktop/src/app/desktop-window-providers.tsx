"use client";

import { ModelProvider } from "@llm-space/ui/components/model-provider";
import type { ModelCatalogController } from "@llm-space/ui/host";
import type { ReactNode } from "react";

import { CommandProvider } from "@/commands";
import { DesktopHostProvider } from "@/host/host-services";

import { useInject } from "./di/react";
import { DesktopModelCatalogController } from "./models/desktop-model-catalog-controller";

/**
 * Owns the renderer capabilities shared by every native Desktop window.
 * Provider ordering is part of this module's interface: the host adapter uses
 * commands, while shared UI reads both host and model clients.
 */
export function DesktopWindowProviders({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CommandProvider>
      <DesktopHostProvider>
        <InjectedModelProvider>{children}</InjectedModelProvider>
      </DesktopHostProvider>
    </CommandProvider>
  );
}

function InjectedModelProvider({ children }: { children: ReactNode }) {
  const controller = useInject<ModelCatalogController>(
    DesktopModelCatalogController
  );
  return <ModelProvider controller={controller}>{children}</ModelProvider>;
}
