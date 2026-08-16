"use client";

import { ModelProvider } from "@llm-space/ui/components/model-provider";
import type { ModelCatalogController } from "@llm-space/ui/host";
import { useMemo, type ReactNode } from "react";

import { CommandProvider } from "@/commands";
import { DesktopHostProvider } from "@/host/host-services";
import type { DesktopWindowContext } from "@/shared/agent-project";

import { MODEL_CATALOG_CONTROLLER } from "./di/common-module";
import { createRendererWindowScope } from "./di/create-renderer-window-scope";
import { RendererScopeProvider, useInject } from "./di/react";

/**
 * Owns the renderer capabilities shared by every native Desktop window.
 * Provider ordering is part of this module's interface: the host adapter uses
 * commands, while shared UI reads both host and model clients.
 */
export function DesktopWindowProviders({
  children,
  context,
}: {
  children: ReactNode;
  context: DesktopWindowContext;
}) {
  const scope = useMemo(() => createRendererWindowScope(context), [context]);
  return (
    <RendererScopeProvider scope={scope}>
      <CommandProvider>
        <DesktopHostProvider>
          <InjectedModelProvider>{children}</InjectedModelProvider>
        </DesktopHostProvider>
      </CommandProvider>
    </RendererScopeProvider>
  );
}

function InjectedModelProvider({ children }: { children: ReactNode }) {
  const controller = useInject<ModelCatalogController>(
    MODEL_CATALOG_CONTROLLER
  );
  return <ModelProvider controller={controller}>{children}</ModelProvider>;
}
