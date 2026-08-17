"use client";

import { Dialog, DialogContent } from "@llm-space/ui/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@llm-space/ui/ui/tabs";
import {
  Boxes,
  Cable,
  CircleUser,
  FlaskConical,
  Network,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";

import {
  RendererSessionContainerProvider,
  useRendererContainer,
} from "@/app/di/react";
import { createSettingsContainer } from "@/app/di/settings-module";
import { useDialogSessionPresence } from "@/components/use-dialog-session-presence";
import type { SettingsTab } from "@/shared/commands";

import { AccountPage } from "./account-page";
import { ExperimentalPage } from "./experimental-page";
import { GeneralPage } from "./general-page";
import { McpPage } from "./mcp-page";
import { ModelsPage } from "./models/models-page";
import { NetworkPage } from "./network-page";
import { SearchPage } from "./search-page";
import { SkillsPage } from "./skills-page";

const PAGES = [
  {
    group: "App",
    value: "general",
    label: "General",
    icon: SlidersHorizontal,
    Page: () => <GeneralPage />,
  },
  {
    group: "App",
    value: "account",
    label: "Account",
    icon: CircleUser,
    Page: () => <AccountPage />,
  },
  {
    group: "Agent",
    value: "models",
    label: "Models",
    icon: Boxes,
    Page: () => <ModelsPage />,
  },
  {
    group: "Agent",
    value: "skills",
    label: "Skills",
    icon: Sparkles,
    Page: () => <SkillsPage />,
  },
  {
    group: "Agent",
    value: "mcp",
    label: "MCP Servers",
    icon: Cable,
    Page: () => <McpPage />,
  },
  {
    group: "Agent",
    value: "search",
    label: "Web Search",
    icon: Search,
    Page: () => <SearchPage />,
  },
  {
    group: "Connections",
    value: "network",
    label: "Network",
    icon: Network,
    Page: () => <NetworkPage />,
  },
  {
    group: null,
    value: "experimental",
    label: "Experimental",
    icon: FlaskConical,
    Page: () => <ExperimentalPage />,
  },
] as const;

const PAGE_GROUPS = ["App", "Agent", "Connections"] as const;

export function SettingsDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
}: SettingsDialogProps) {
  const parent = useRendererContainer();
  const present = useDialogSessionPresence(open);
  if (!present) return null;
  return (
    <SettingsDialogSession
      parent={parent}
      open={open}
      onOpenChange={onOpenChange}
      tab={tab}
      onTabChange={onTabChange}
    />
  );
}

/** Own one fresh Settings child Container for exactly one open interaction. */
function SettingsDialogSession({
  parent,
  ...props
}: SettingsDialogProps & {
  readonly parent: ReturnType<typeof useRendererContainer>;
}) {
  const container = useMemo(() => createSettingsContainer(parent), [parent]);
  return (
    <RendererSessionContainerProvider container={container}>
      <SettingsDialogContent {...props} />
    </RendererSessionContainerProvider>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

function SettingsDialogContent({
  open,
  onOpenChange,
  tab,
  onTabChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl! gap-0 overflow-hidden rounded-2xl p-0"
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
        }}
      >
        <Tabs
          className="h-[75vh] w-full gap-0"
          orientation="vertical"
          value={tab}
          onValueChange={(value) => onTabChange(value as SettingsTab)}
        >
          <aside className="bg-muted/30 flex w-50 shrink-0 flex-col gap-2 border-r p-3">
            <header>
              <div className="text-base font-medium">Settings</div>
            </header>
            <TabsList className="h-fit w-full flex-col gap-0 bg-transparent p-0">
              {PAGE_GROUPS.map((group) => (
                <div key={group} className="mb-4 w-full" role="presentation">
                  <div className="text-muted-foreground/70 dark:text-muted-foreground/50 px-2 pb-1 text-[10px] font-medium">
                    {group}
                  </div>
                  <div className="flex flex-col gap-0.5" role="presentation">
                    {PAGES.filter((page) => page.group === group).map(
                      ({ value, label, icon: Icon }) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className="data-active:border-primary/25 data-active:bg-primary/10 data-active:text-primary data-active:hover:text-primary dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground dark:data-active:hover:text-foreground w-full pl-5"
                        >
                          <Icon />
                          {label}
                        </TabsTrigger>
                      )
                    )}
                  </div>
                </div>
              ))}
              <div className="w-full border-t pt-2" role="presentation">
                {PAGES.filter((page) => page.group === null).map(
                  ({ value, label, icon: Icon }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="data-active:border-primary/25 data-active:bg-primary/10 data-active:text-primary data-active:hover:text-primary dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground dark:data-active:hover:text-foreground w-full"
                    >
                      <Icon />
                      {label}
                    </TabsTrigger>
                  )
                )}
              </div>
            </TabsList>
          </aside>
          <div className="min-w-0 grow">
            {PAGES.map(({ value, Page }) => (
              <TabsContent key={value} value={value} className="size-full">
                <Page />
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
