"use client";

import {
  DEFAULT_SEARCH_SETTINGS,
  type SearchProviderId,
  type SearchSettings,
} from "@llm-space/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@llm-space/ui/ui/select";
import { Separator } from "@llm-space/ui/ui/separator";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { SettingsFormController } from "@/app/settings/settings-form-controller";
import { createSearchClient } from "@/client/search";

import { ApiKeyField } from "./api-key-field";
import { SettingsPage } from "./settings-page";

export function SearchPage() {
  const client = useMemo(() => createSearchClient(), []);
  const controller = useMemo(
    () =>
      new SettingsFormController<SearchSettings>({
        initialSettings: DEFAULT_SEARCH_SETTINGS,
        initialContext: undefined,
        loadSettings: () => client.get(),
        saveSettings: (settings) => client.set(settings),
        notifySaveError: (error) => {
          toast.error("Failed to save search settings", {
            description:
              error instanceof Error ? error.message : "Please try again.",
          });
        },
      }),
    [client]
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  const settings = snapshot.settings;

  return (
    <SettingsPage
      title="Search"
      className="pt-0"
      description={
        <>
          Choose the provider for the built-in <code>web_search</code> tool.
          When Brave Search is selected, <code>web_fetch</code> continues to use
          Firecrawl for safe page extraction.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex h-14 items-center justify-between gap-4">
          <span className="text-sm">Search provider</span>
          <Select
            value={settings.provider}
            onValueChange={(value) =>
              void controller.commit({
                ...settings,
                provider: value as SearchProviderId,
              })
            }
          >
            <SelectTrigger className="w-40" aria-label="Search provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="brave">Brave Search</SelectItem>
              <SelectItem value="firecrawl">Firecrawl</SelectItem>
              <SelectItem value="tavily">Tavily</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <ApiKeyField
          label="Brave Search API key"
          value={settings.braveApiKey}
          getKeyUrl="https://api-dashboard.search.brave.com/app/keys"
          onChange={(e) =>
            controller.update({
              ...settings,
              braveApiKey: e.target.value,
            })
          }
          onBlur={() => void controller.save()}
        />

        <ApiKeyField
          label="Firecrawl API key"
          value={settings.firecrawlApiKey}
          getKeyUrl="https://www.firecrawl.dev/app/api-keys"
          onChange={(e) =>
            controller.update({
              ...settings,
              firecrawlApiKey: e.target.value,
            })
          }
          onBlur={() => void controller.save()}
        />

        <ApiKeyField
          label="Tavily API key"
          value={settings.tavilyApiKey}
          getKeyUrl="https://app.tavily.com/home"
          onChange={(e) =>
            controller.update({
              ...settings,
              tavilyApiKey: e.target.value,
            })
          }
          onBlur={() => void controller.save()}
        />

        <p className="text-muted-foreground text-xs">
          Values starting with <code>$</code> are read from the environment
          (e.g. <code>$BRAVE_SEARCH_API_KEY</code>,{" "}
          <code>$FIRECRAWL_API_KEY</code>, <code>$TAVILY_API_KEY</code>).
        </p>
      </div>
    </SettingsPage>
  );
}
