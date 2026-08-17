// react-scan must initialize before React so it can patch the reconciler.
// Dev-only: `import.meta.env.DEV` is statically false in production builds, so
// the toolbar is tree-shaken out of shipped bundles.

import {
  LOCAL_STORAGE_KEYS,
  readLocalStorage,
} from "@llm-space/ui/lib/local-storage";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { scan } from "react-scan";

import "@/lib/electrobun";

import { App } from "../app";
import { createRendererWindowContainer } from "../app/di/create-renderer-window-container";
import {
  disposeRendererContainer,
  RendererApplication,
} from "../app/di/lifecycle";
import { RendererContainerProvider } from "../app/di/react";
import { createElectrobunRpcTransport } from "../app/rpc/electrobun-rpc-transport";
import { createRpcClient } from "../shared/namespaced-rpc";
import { WINDOW_RPC } from "../shared/window-rpc";

// Opt-in via the Experimental settings; the toggle only takes effect on the
// next reload since react-scan must patch the reconciler before React renders.
// Gated on `import.meta.env.DEV` (statically false in production), so the whole
// block — and the `react-scan` import — is tree-shaken out of shipped bundles.
if (
  import.meta.env.DEV &&
  readLocalStorage(LOCAL_STORAGE_KEYS.experimentalReactScan) === "true"
) {
  scan({ enabled: true });
}

const root = createRoot(document.getElementById("root")!);

void bootstrapRenderer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <div className="text-destructive grid size-full place-items-center p-8">
      {message}
    </div>
  );
});

/** Resolve WindowContext before creating the independent renderer graph. */
async function bootstrapRenderer(): Promise<void> {
  const transport = createElectrobunRpcTransport();
  const context = await createRpcClient(WINDOW_RPC, transport).getContext();
  const container = createRendererWindowContainer(context, transport);
  const application = container.get(RendererApplication);
  application.start();
  root.render(
    <StrictMode>
      <RendererContainerProvider container={container}>
        <App context={context} />
      </RendererContainerProvider>
    </StrictMode>
  );
  window.addEventListener(
    "unload",
    () => {
      application.prepareToStop();
      root.unmount();
      void disposeRendererContainer(container);
    },
    { once: true }
  );
}
