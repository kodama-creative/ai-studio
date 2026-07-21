"use client";

import { SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModelConfig } from "@llm-space/core";

import { useCommands } from "@/commands";
import { cn } from "@/lib/utils";
import { useModels, useRefreshModels } from "../../model-provider";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator
} from "../../ui/combobox";
import { ModelAvatar } from "../model-avatar";
import { ProviderAvatar } from "../provider-avatar";
import { useThreadStoreActions } from "../stores";

function toModelKey(model: Pick<ModelConfig, "id" | "provider">) {
  return `${model.provider}:${model.id}`;
}

function parseModelKey(key: string) {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }
  return {
    provider: key.slice(0, separatorIndex),
    id: key.slice(separatorIndex + 1)
  };
}

export function ModelSelector({
  value,
  readonly,
  onOpenChange
}: {
  readonly readonly?: boolean;
  readonly value: ModelConfig | null;

  readonly onOpenChange?: (open: boolean) => void;
}) {
  const providers = useModels();
  const refreshModels = useRefreshModels();
  const { updateModel } = useThreadStoreActions();
  const { executeCommand } = useCommands();
  const [open, setOpen] = useState(false);
  const selectedValue = value ? toModelKey(value) : "";

  const items = useMemo(() => {
    const groups = [...providers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(group => {
        const disabled = new Set(group.disabledModels ?? []);
        return {
          id: group.id,
          name: group.name,
          icon: group.icon,
          items: group.models
            .filter(model => !disabled.has(model.id))
            .map(model => toModelKey(model))
        };
      })
      .filter(group => group.items.length > 0);
    if (
      selectedValue
      && !groups.some(group => group.items.includes(selectedValue))
    ) {
      groups.unshift({
        id: "unavailable",
        name: "Unavailable",
        icon: undefined,
        items: [selectedValue]
      });
    }
    return groups;
  }, [providers, selectedValue]);

  const modelMeta = useMemo(() => {
    const meta = new Map<string, { icon?: string; id: string; name: string; }>();
    for (const group of providers) {
      for (const model of group.models) {
        meta.set(toModelKey(model), {
          id: model.id,
          name: model.name,
          icon: model.icon
        });
      }
    }
    if (value && !meta.has(selectedValue)) {
      meta.set(selectedValue, {
        id: value.id,
        name: `${value.provider}/${value.id}`
      });
    }
    return meta;
  }, [providers, selectedValue, value]);

  const inputRef = useRef<HTMLInputElement>(null);
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        // Always read fresh from the main process on open — never cache.
        void refreshModels();
      } else {
        inputRef.current?.blur();
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, refreshModels]
  );

  const configureModels = useCallback(() => {
    handleOpenChange(false);
    executeCommand({ type: "openSettings", args: { tab: "models" } });
  }, [executeCommand, handleOpenChange]);

  const filterItems = useCallback(
    (itemValue: string, query: string) => {
      const label = modelMeta.get(itemValue)?.name ?? itemValue;
      return label.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    },
    [modelMeta]
  );

  useEffect(() => {
    const trigger = inputRef.current
      ?.closest<HTMLElement>('[data-slot="input-group"]')
      ?.querySelector<HTMLElement>('[data-slot="input-group-button"]');
    trigger?.setAttribute("aria-label", "Open model selector");
  }, []);

  return (
    <Combobox
      disabled={readonly}
      filter={filterItems}
      items={items}
      itemToStringLabel={itemValue =>
        modelMeta.get(itemValue)?.name ?? itemValue}
      onOpenChange={handleOpenChange}
      onValueChange={nextValue => {
        if (!nextValue || readonly) {
          return;
        }
        const parsed = parseModelKey(nextValue);
        if (!parsed) {
          return;
        }
        updateModel(parsed);
      }}
      open={open}
      value={selectedValue}
    >
      <ComboboxInput
        aria-label="Model selector"
        className={cn(
          "hover:bg-secondary! group/model-select h-6! w-75 border-0 bg-transparent! font-mono",
          !readonly && "cursor:pointer hover:bg-secondary"
        )}
        disabled={readonly}
        placeholder="(No model selected)"
        ref={inputRef}
        triggerClassName={readonly ? "invisible" : "opacity-100!"}
      />
      <ComboboxContent className="w-96">
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(provider: {
            icon?: string;
            id: string;
            items: string[];
            name: string;
          }) => (
            <ComboboxGroup
              className="mb-2"
              items={provider.items}
              key={provider.name}
            >
              <ComboboxLabel className="flex items-center gap-1.5">
                <ProviderAvatar
                  icon={provider.icon}
                  id={provider.id}
                  name={provider.name}
                  size={14}
                />
                {provider.name}
              </ComboboxLabel>
              <ComboboxCollection>
                {(modelKey: string) => {
                  const meta = modelMeta.get(modelKey);
                  return (
                    <ComboboxItem
                      className="flex items-center gap-2 pl-4"
                      key={modelKey}
                      value={modelKey}
                    >
                      <ModelAvatar
                        icon={meta?.icon}
                        id={meta?.id ?? modelKey}
                        name={meta?.name ?? modelKey}
                        size={16}
                      />
                      {meta?.name ?? modelKey}
                    </ComboboxItem>
                  );
                }}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <ComboboxSeparator className="mx-1 my-0" />
        <div className="w-full p-1">
          <button
            className="hover:bg-accent hover:text-accent-foreground text-muted-foreground flex min-h-7 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs/relaxed outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
            onClick={configureModels}
            onMouseDown={e => { e.preventDefault(); }}
            type="button"
          >
            <SettingsIcon />
            Configure models...
          </button>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}
