"use client";

import type { ModelProviderGroup } from "@llm-space/core";
import { ConfirmDialog } from "@llm-space/ui/components/confirm-dialog";
import { ProviderAvatar } from "@llm-space/ui/components/thread-playground/provider-avatar";
import { useAutoAnimation } from "@llm-space/ui/lib/use-auto-animation";
import { cn } from "@llm-space/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@llm-space/ui/ui/dropdown-menu";
import { Input } from "@llm-space/ui/ui/input";
import { ScrollArea } from "@llm-space/ui/ui/scroll-area";
import { MoreHorizontal, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useController } from "@/app/di/react";
import { MODELS_SETTINGS_CONTROLLER } from "@/app/di/settings-module";
import { ModelsSettingsController } from "@/app/settings/models/models-settings-controller";

import { SettingsPage } from "../settings-page";

import { AddProviderMenu } from "./add-provider-menu";
import { ProviderEditor } from "./provider-editor";

function sortProviders(
  providers: readonly ModelProviderGroup[]
): ModelProviderGroup[] {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name));
}

export function ModelsPage() {
  const { controller, state: snapshot } = useController(
    MODELS_SETTINGS_CONTROLLER
  );
  const selected = controller.getSelectedProvider();
  const removalCandidate = snapshot.providers.find(
    (provider) => provider.id === snapshot.removalCandidateId
  );

  return (
    <SettingsPage
      className="flex size-full min-h-0"
      title="Models"
      description="LLM Space supports various model providers and their custom models, from OpenAI, Anthropic and Google compatible to Codex."
    >
      <ProviderList
        controller={controller}
        providers={snapshot.providers}
        selectedId={snapshot.selectedProviderId}
      />
      <ProviderEditor controller={controller} provider={selected} />
      <ConfirmDialog
        open={removalCandidate !== undefined}
        onOpenChange={(open) => {
          if (!open) controller.cancelRemoveProvider();
        }}
        title={`Remove ${removalCandidate?.name ?? "provider"}?`}
        description={`This removes ${removalCandidate?.name ?? "provider"} from your configured providers. You can add it back later.`}
        confirmLabel="Remove"
        dimBackground={false}
        onConfirm={() => void controller.confirmRemoveProvider()}
      />
    </SettingsPage>
  );
}

function ProviderList({
  controller,
  providers,
  selectedId,
}: {
  controller: ModelsSettingsController;
  providers: readonly ModelProviderGroup[];
  selectedId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [listRef] = useAutoAnimation<HTMLDivElement>();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? providers.filter((provider) => provider.name.toLowerCase().includes(q))
      : providers;
    return sortProviders(matched);
  }, [providers, query]);

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-r pr-4">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        PROVIDERS
      </span>

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          className="h-8 pl-7"
          aria-label="Search providers"
          placeholder="Search providers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ScrollArea className="min-h-0 grow">
        {providers.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
            No providers yet. Click the &quot;Add provider&quot; button below to
            get started.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
            No provider matches &quot;{query.trim()}&quot;.
          </div>
        ) : (
          <div ref={listRef} className="flex flex-col gap-1 pr-2">
            {filtered.map((provider) => (
              <ProviderListItem
                key={provider.id}
                provider={provider}
                selected={provider.id === selectedId}
                onSelect={() => controller.selectProvider(provider.id)}
                onRemove={() => controller.requestRemoveProvider(provider.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <AddProviderMenu
        controller={controller}
        snapshot={controller.getSnapshot().addProvider}
        configured={providers}
      />
    </div>
  );
}

function ProviderListItem({
  provider,
  selected,
  onSelect,
  onRemove,
}: {
  provider: ModelProviderGroup;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Select ${provider.name} provider`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
        selected ? "bg-muted font-medium" : "hover:bg-muted/50"
      )}
    >
      <ProviderAvatar
        id={provider.id}
        name={provider.name}
        icon={provider.icon}
      />
      <span className="line-clamp-1 grow">{provider.name}</span>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label={`${provider.name} provider actions`}
            title={`${provider.name} provider actions`}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Trash2 />
            Remove {provider.name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
