"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getSearchSettings, setSearchSettings } from "@/client/search";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_SEARCH_SETTINGS,
  type SearchProviderId,
  type SearchSettings
} from "@/shared/search";
import { ApiKeyField } from "./api-key-field";
import { SettingsPage } from "./settings-page";

export function SearchPage() {
  const [settings, setSettings] = useState<SearchSettings>(
    DEFAULT_SEARCH_SETTINGS
  );

  useEffect(() => {
    let cancelled = false;
    void getSearchSettings()
      .then(loaded => {
        if (!cancelled) {
          setSettings(loaded);
        }
      })
      .catch(() => {
        // Keep defaults; a load failure is non-fatal for the form.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: SearchSettings) => {
    try {
      const saved = await setSearchSettings(next);
      setSettings(saved);
    } catch (error) {
      toast.error("Failed to save search settings", {
        description:
          error instanceof Error ? error.message : "Please try again."
      });
    }
  }, []);

  return (
    <SettingsPage
      description={
        <>
          These settings only apply to the built-in <code>web_search</code> and{" "}
          <code>web_fetch</code> tools.
        </>
      }
      title="Search"
    >
      <div className="flex flex-col gap-4">
        <div className="flex h-14 items-center justify-between gap-4">
          <span className="text-sm">Search provider</span>
          <Select
            onValueChange={value => {
              void persist({ ...settings, provider: value as SearchProviderId });
            }}
            value={settings.provider}
          >
            <SelectTrigger aria-label="Search provider" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="firecrawl">Firecrawl</SelectItem>
              <SelectItem value="tavily">Tavily</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <ApiKeyField
          getKeyUrl="https://www.firecrawl.dev/app/api-keys"
          label="Firecrawl API key"
          onBlur={() => {
            void persist(settings);
          }}
          onChange={e => { setSettings({ ...settings, firecrawlApiKey: e.target.value }); }}
          value={settings.firecrawlApiKey}
        />

        <ApiKeyField
          getKeyUrl="https://app.tavily.com/home"
          label="Tavily API key"
          onBlur={() => {
            void persist(settings);
          }}
          onChange={e => { setSettings({ ...settings, tavilyApiKey: e.target.value }); }}
          value={settings.tavilyApiKey}
        />

        <p className="text-muted-foreground text-xs">
          Values starting with <code>$</code> are read from the environment
          (e.g. <code>$FIRECRAWL_API_KEY</code>, <code>$TAVILY_API_KEY</code>).
        </p>
      </div>
    </SettingsPage>
  );
}
