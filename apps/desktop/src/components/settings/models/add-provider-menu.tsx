"use client";

import type { ModelProviderGroup } from "@llm-space/core";
import { Link } from "@llm-space/ui/components/link";
import { ProviderAvatar } from "@llm-space/ui/components/thread-playground/provider-avatar";
import { Button } from "@llm-space/ui/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@llm-space/ui/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@llm-space/ui/ui/popover";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";

import type {
  ModelsSettingsController,
  ModelsSettingsSnapshot,
} from "@/app/settings/models/models-settings-controller";

const RECOMMENDED_PROVIDER_IDS = new Set([
  "ark",
  "ark-agent-plan",
  "ark-coding-plan",
  "openai",
  "anthropic",
  "google",
  "deepseek",
]);

/** Presentation adapter for the aggregate-owned Add Provider session. */
export function AddProviderMenu({
  controller,
  snapshot,
  configured,
}: {
  controller: ModelsSettingsController;
  snapshot: ModelsSettingsSnapshot["addProvider"];
  configured: readonly ModelProviderGroup[];
}) {
  const intents = controller.intents.addProvider;

  const configuredIds = useMemo(
    () => new Set(configured.map((provider) => provider.id)),
    [configured]
  );
  const groups = useMemo(() => {
    const discovered: ModelProviderGroup[] = [];
    const recommended: ModelProviderGroup[] = [];
    const rest: ModelProviderGroup[] = [];
    for (const provider of snapshot.builtinProviders ?? []) {
      if (configuredIds.has(provider.id)) continue;
      if (provider.apiKeyDetected) discovered.push(provider);
      else if (RECOMMENDED_PROVIDER_IDS.has(provider.id)) {
        recommended.push(provider);
      } else rest.push(provider);
    }

    const result: {
      id: string;
      label: ReactNode;
      items: ModelProviderGroup[];
    }[] = [];
    if (discovered.length > 0) {
      result.push({
        id: "discovered",
        label: (
          <div className="flex flex-col gap-2">
            <div className="text-foreground text-xs font-medium">
              Discovered
            </div>
            <div className="flex gap-1 pl-1">
              {discovered.length}{" "}
              {discovered.length === 1 ? "provider" : "providers"} discovered in
              your environment
            </div>
          </div>
        ),
        items: discovered,
      });
    }
    if (recommended.length > 0) {
      result.push({
        id: "recommended",
        label: "Recommended",
        items: recommended,
      });
    }
    if (rest.length > 0) {
      result.push({ id: "built-in", label: "Built-in", items: rest });
    }
    return result;
  }, [configuredIds, snapshot.builtinProviders]);

  return (
    <Popover open={snapshot.open} onOpenChange={intents.setOpen} modal>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full">
          <Plus />
          Add provider
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search providers..." />
          <CommandList className="max-h-72">
            <CommandEmpty>No providers found.</CommandEmpty>
            <CommandGroup heading="Customized">
              <CommandItem
                value="Add custom provider"
                disabled={snapshot.addingProviderId !== null}
                onSelect={() => void intents.choose({ type: "custom" })}
              >
                <ProviderAvatar id="custom-provider" name="Custom provider" />
                <span className="line-clamp-1 grow">Add custom provider</span>
                {snapshot.addingProviderId === "custom" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
              </CommandItem>
            </CommandGroup>
            {snapshot.builtinProviders === null ? (
              <CommandGroup heading="Built-in">
                <CommandItem disabled value="Loading built-in providers">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading providers…
                </CommandItem>
              </CommandGroup>
            ) : null}
            {snapshot.discoveryFailed ? (
              <CommandGroup heading="Built-in">
                <CommandItem disabled value="Provider discovery failed">
                  Built-in providers could not be loaded.
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map((group) => (
              <Fragment key={group.id}>
                <CommandSeparator />
                <CommandGroup heading={group.label}>
                  {group.items.map((provider) => (
                    <CommandItem
                      key={provider.id}
                      value={`${provider.name} ${provider.id}`}
                      disabled={snapshot.addingProviderId !== null}
                      onSelect={() =>
                        void intents.choose({ type: "builtin", provider })
                      }
                    >
                      <ProviderAvatar
                        id={provider.id}
                        name={provider.name}
                        icon={provider.icon}
                      />
                      <span className="line-clamp-1 grow">{provider.name}</span>
                      {snapshot.addingProviderId === provider.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      {provider.websiteURL ? (
                        <Link
                          href={provider.websiteURL}
                          aria-label={`Open ${provider.name} website`}
                          className="text-muted-foreground/80 hover:text-foreground shrink-0"
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="size-2.5" />
                        </Link>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
