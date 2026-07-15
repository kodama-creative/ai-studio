"use client";

import {
  Boxes,
  Cable,
  FlaskConical,
  Search,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExperimentalPage } from "./experimental-page";
import { GeneralPage } from "./general-page";
import { McpPage } from "./mcp-page";
import { ModelsPage } from "./models-page";
import { SearchPage } from "./search-page";
import { SkillsPage } from "./skills-page";

import type { SettingsTab } from "@/shared/commands";

const PAGES = [
  {
    value: "general",
    label: "General",
    icon: SlidersHorizontal,
    Page: GeneralPage
  },
  { value: "models", label: "Models", icon: Boxes, Page: ModelsPage },
  { value: "mcp", label: "MCP", icon: Cable, Page: McpPage },
  { value: "search", label: "Search", icon: Search, Page: SearchPage },
  { value: "skills", label: "Skills", icon: Sparkles, Page: SkillsPage },
  {
    value: "experimental",
    label: "Experimental",
    icon: FlaskConical,
    Page: ExperimentalPage
  }
] as const;

export function SettingsDialog({
  open,
  onOpenChange,
  tab,
  onTabChange
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onTabChange: (tab: SettingsTab) => void;
  readonly open: boolean;
  readonly tab: SettingsTab;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-5xl! gap-0 p-0"
        onInteractOutside={event => {
          event.preventDefault();
        }}
        onPointerDownOutside={event => {
          event.preventDefault();
        }}
      >
        <Tabs
          className="h-[75vh] w-full gap-0"
          onValueChange={value => { onTabChange(value as SettingsTab); }}
          orientation="vertical"
          value={tab}
        >
          <aside className="bg-muted/30 flex w-50 shrink-0 flex-col gap-2 border-r p-3">
            <header>
              <div className="text-base font-medium">Settings</div>
            </header>
            <TabsList className="h-fit w-full flex-col gap-0.5 bg-transparent p-0">
              {PAGES.map(({ value, label, icon: Icon }) => (
                <TabsTrigger className="w-full" key={value} value={value}>
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </aside>
          <div className="min-w-0 grow">
            {PAGES.map(({ value, Page }) => (
              <TabsContent className="size-full" key={value} value={value}>
                <Page />
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
