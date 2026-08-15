import { useEffect, useMemo, useState } from "react";

import { createWindowClient } from "@/client/window";
import type { DesktopWindowContext } from "@/shared/agent-project";

import { DesktopWindowProviders } from "./desktop-window-providers";
import { Layout } from "./layout";
import { MainWindowPage } from "./page";
import { ProjectPage } from "./project-page";

export function App() {
  const windowClient = useMemo(() => createWindowClient(), []);
  const [context, setContext] = useState<DesktopWindowContext>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void windowClient.getContext().then(setContext, (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [windowClient]);

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
      ) : (
        <DesktopWindowProviders>
          {context.kind === "agentProject" ? (
            <ProjectPage project={context.project} />
          ) : (
            <MainWindowPage />
          )}
        </DesktopWindowProviders>
      )}
    </Layout>
  );
}
