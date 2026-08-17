import type { DesktopWindowContext } from "@/shared/agent-project";

import { DesktopWindowProviders } from "./desktop-window-providers";
import { Layout } from "./layout";
import { MainWindowPage } from "./page";
import { ProjectPage } from "./project-page";

export function App({ context }: { readonly context: DesktopWindowContext }) {
  return (
    <Layout>
      <DesktopWindowProviders>
        {context.kind === "agentProject" ? (
          <ProjectPage />
        ) : (
          <MainWindowPage />
        )}
      </DesktopWindowProviders>
    </Layout>
  );
}
