import type { ModelProviderGroup } from "@llm-space/core";

import { ExperimentalProvider } from "@/components/experimental-provider";
import { ModelProvider } from "@/components/model-provider";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { electrobun } from "@/lib/electrobun";
import { QueryProvider } from "./query-provider";

import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@/styles/globals.css";

export function Layout({ children }: { readonly children: React.ReactNode; }) {
  return (
    <ThemeProvider>
      <ExperimentalProvider>
        <QueryProvider>
          <ModelProvider fetcher={fetchModels}>
            <TooltipProvider delayDuration={1000}>
              <div className="flex size-full flex-col">
                <ThemedToaster />
                {children}
              </div>
            </TooltipProvider>
          </ModelProvider>
        </QueryProvider>
      </ExperimentalProvider>
    </ThemeProvider>
  );
}

/** Sonner toaster that tracks the active appearance. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      closeButton
      offset={28}
      position="top-center"
      theme={resolvedTheme}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          description: "text-muted-foreground!"
        }
      }}
    />
  );
}

async function fetchModels(): Promise<ModelProviderGroup[]> {
  if (!electrobun.rpc) {
    throw new Error("Electrobun RPC is not initialized");
  }
  const models = await electrobun.rpc.request.availableModels({});
  return models;
}
