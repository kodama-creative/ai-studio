import { useEffect, useState } from "react";

import { CommandProvider } from "@/commands";
import {
  createElectrobunModelClient,
  DesktopHostProvider,
} from "@/host/host-services";
import { electrobun } from "@/lib/electrobun";
import type { DesktopWindowContext } from "@/shared/agent-project";

import { Layout } from "./layout";
import { Page } from "./page";
import { ProjectPage } from "./project-page";
import { WorkspaceModelScope } from "./workspace-model-scope";

export function App() {
  const [context, setContext] = useState<DesktopWindowContext>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (rpc === undefined) {
      setError("Electrobun RPC is not initialized.");
      return;
    }
    void rpc.request.windowContext({}).then(setContext, (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  return (
    <Layout>
      {error !== undefined ? (
        <div className="text-destructive grid size-full place-items-center p-8">
          {error}
        </div>
      ) : context === undefined ? (
        <div className="text-muted-foreground grid size-full place-items-center text-sm">
          Opening workspace…
        </div>
      ) : context.kind === "agentProject" ? (
        <CommandProvider>
          <DesktopHostProvider>
            <WorkspaceModelScope
              runtimeId="local"
              createClient={createElectrobunModelClient}
            >
              <ProjectPage project={context.project} />
            </WorkspaceModelScope>
          </DesktopHostProvider>
        </CommandProvider>
      ) : (
        <Page />
      )}
    </Layout>
  );
}
