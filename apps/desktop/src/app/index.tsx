import { useEffect, useState } from "react";

import { windowClient } from "@/client/native-files";
import { CommandProvider } from "@/commands";
import {
  createElectrobunModelClient,
  DesktopHostProvider,
} from "@/host/host-services";
import type { DesktopWindowContext } from "@/shared/agent-project";

import { DesktopModelProvider } from "./desktop-model-provider";
import { Layout } from "./layout";
import { Page } from "./page";
import { ProjectPage } from "./project-page";

export function App() {
  const [context, setContext] = useState<DesktopWindowContext>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void windowClient.getContext().then(setContext, (cause) => {
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
            <DesktopModelProvider createClient={createElectrobunModelClient}>
              <ProjectPage project={context.project} />
            </DesktopModelProvider>
          </DesktopHostProvider>
        </CommandProvider>
      ) : (
        <Page />
      )}
    </Layout>
  );
}
