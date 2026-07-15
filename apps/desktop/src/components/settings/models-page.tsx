"use client";

import {
  Ban,
  CableIcon,
  Check,
  CheckCheck,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { CustomModel, ModelProviderGroup } from "@llm-space/core";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle
} from "@/components/ui/item";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAutoAnimation } from "@/lib/use-auto-animation";
import { cn } from "@/lib/utils";
import { ApiKeyField } from "./api-key-field";
import {
  CUSTOM_PROVIDER_API_TYPES,
  type CustomProviderApi,
  DEFAULT_CUSTOM_PROVIDER_API
} from "./custom-provider-api";
import { ModelEditorDialog } from "./model-editor-dialog";
import { SettingsPage } from "./settings-page";
import { ConfirmDialog } from "../confirm-dialog";
import { Link } from "../link";
import {
  useAddCustomProvider,
  useAddProvider,
  useFetchBuiltinProviders,
  useModels,
  useRemoveCustomModel,
  useRemoveProvider,
  useSetAllModelsEnabled,
  useSetModelEnabled,
  useTestModelConnection,
  useUpdateProvider
} from "../model-provider";
import { ModelAvatar } from "../thread-playground/model-avatar";
import { ProviderAvatar } from "../thread-playground/provider-avatar";
import { Tooltip } from "../tooltip";
import { ScrollArea } from "../ui/scroll-area";

/**
 * Base-URL guidance for the Anthropic Messages API. Its SDK appends `/v1/...`
 * to the base URL itself, so — unlike the OpenAI-style APIs, whose SDKs expect
 * the `/v1` to be part of the base URL — a `/v1` suffix here would double up
 * into `/v1/v1/...` on every request.
 */
const ANTHROPIC_BASE_URL_HINT =
  "The Anthropic SDK adds /v1 to the request path itself, so enter the URL without a /v1 suffix.";

function sortProviders(providers: ModelProviderGroup[]): ModelProviderGroup[] {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name));
}

export function ModelsPage() {
  const providers = useModels();
  const firstProviderId = useMemo(
    () => sortProviders(providers)[0]?.id ?? null,
    [providers]
  );
  const [selectedId, setSelectedId] = useState<string | null>(firstProviderId);

  useEffect(() => {
    if (
      !selectedId
      || !providers.some(provider => provider.id === selectedId)
    ) {
      setSelectedId(firstProviderId);
    }
  }, [firstProviderId, providers, selectedId]);

  const selected =
    providers.find(provider => provider.id === selectedId) ?? null;

  return (
    <SettingsPage
      className="flex size-full min-h-0"
      description="LLM Space supports various model providers and their custom models, from OpenAI, Anthropic and Google compatible to Codex."
      title="Models"
    >
      <ProviderList
        onAdd={setSelectedId}
        onSelect={setSelectedId}
        providers={providers}
        selectedId={selectedId}
      />
      <ProviderEditor key={selected?.id} provider={selected} />
    </SettingsPage>
  );
}

function ProviderList({
  providers,
  selectedId,
  onSelect,
  onAdd
}: {
  readonly onAdd: (id: string) => void;
  readonly onSelect: (id: string) => void;
  readonly providers: ModelProviderGroup[];
  readonly selectedId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [listRef] = useAutoAnimation<HTMLDivElement>();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? providers.filter(provider => provider.name.toLowerCase().includes(q))
      : providers;
    return sortProviders(matched);
  }, [providers, query]);

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-r pr-4">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          aria-label="Search providers"
          className="h-8 pl-7"
          onChange={e => { setQuery(e.target.value); }}
          placeholder="Search providers"
          value={query}
        />
      </div>

      <ScrollArea className="min-h-0 grow">
        {providers.length === 0
          ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
              No providers yet. Click the &quot;Add provider&quot; button below to
              get started.
            </div>
          )
          : filtered.length === 0
            ? (
              <div className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
                No provider matches &quot;{query.trim()}&quot;.
              </div>
            )
            : (
              <div className="flex flex-col gap-1 pr-2" ref={listRef}>
                {filtered.map(provider => (
                  <ProviderListItem
                    key={provider.id}
                    onSelect={() => { onSelect(provider.id); }}
                    provider={provider}
                    selected={provider.id === selectedId}
                  />
                ))}
              </div>
            )}
      </ScrollArea>

      <AddProviderMenu onAdd={onAdd} />
    </div>
  );
}

/**
 * Recommended builtin providers, shown in their own menu group. The `google`
 * provider backs Gemini.
 */
const RECOMMENDED_PROVIDER_IDS = new Set([
  "ark",
  "ark-coding-plan",
  "openai",
  "anthropic",
  "google",
  "deepseek"
]);

/**
 * The "Add provider" upward menu. Lists every builtin provider, split into
 * priority groups: Discovered (an API key was detected and it isn't configured
 * yet), Recommended, then Built-in. Each provider lands in the highest group it
 * qualifies for; empty groups are omitted. Already-configured providers are
 * checked.
 */
function AddProviderMenu({ onAdd }: { readonly onAdd: (id: string) => void; }) {
  const configured = useModels();
  const addProvider = useAddProvider();
  const addCustomProvider = useAddCustomProvider();
  const fetchBuiltins = useFetchBuiltinProviders();
  const [open, setOpen] = useState(false);
  const [builtins, setBuiltins] = useState<ModelProviderGroup[] | null>(null);

  const configuredIds = useMemo(
    () => new Set(configured.map(provider => provider.id)),
    [configured]
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void fetchBuiltins()
        .then(setBuiltins)
        .catch(error => { console.error("Failed to load providers", error); });
    }
  };

  const groups = useMemo(() => {
    const discovered: ModelProviderGroup[] = [];
    const recommended: ModelProviderGroup[] = [];
    const rest: ModelProviderGroup[] = [];
    for (const provider of builtins ?? []) {
      // Only offer providers that haven't been added yet.
      if (configuredIds.has(provider.id)) {
        continue;
      }
      if (provider.apiKeyDetected) {
        discovered.push(provider);
      } else if (RECOMMENDED_PROVIDER_IDS.has(provider.id)) {
        recommended.push(provider);
      } else {
        rest.push(provider);
      }
    }
    const discoveredCount = discovered.length;
    const groups = [];
    if (discoveredCount > 0) {
      groups.push({
        id: "discovered",
        label: (
          <div className="flex flex-col gap-2">
            <div className="text-foreground text-xs font-medium">
              Discovered
            </div>
            <div className="flex gap-1 pl-1">
              {discoveredCount}{" "}
              {discoveredCount === 1 ? "provider" : "providers"} discovered in
              your environment
            </div>
          </div>
        ),
        items: discovered
      });
    }
    if (recommended.length > 0) {
      groups.push({
        id: "recommended",
        label: "Recommended",
        items: recommended
      });
    }
    if (rest.length > 0) {
      groups.push({ id: "built-in", label: "Built-in", items: rest });
    }
    return groups;
  }, [builtins, configuredIds]);

  return (
    <Popover modal onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button className="w-full" variant="outline">
          <Plus />
          Add provider
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" side="top">
        <Command>
          <CommandInput placeholder="Search providers..." />
          <CommandList className="max-h-72">
            <CommandEmpty>No providers found.</CommandEmpty>
            <CommandGroup heading="Customized">
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void addCustomProvider("Custom provider", "").then(onAdd);
                }}
                value="Add custom provider"
              >
                <ProviderAvatar id="custom-provider" name="Custom provider" />
                <span className="line-clamp-1 grow">Add custom provider</span>
              </CommandItem>
            </CommandGroup>
            {groups.map(group => (
              <Fragment key={group.id}>
                <CommandSeparator />
                <CommandGroup heading={group.label}>
                  {group.items.map(provider => (
                    <CommandItem
                      key={provider.id}
                      onSelect={() => {
                        setOpen(false);
                        void addProvider(provider.id).then(() => { onAdd(provider.id); });
                      }}
                      value={`${provider.name} ${provider.id}`}
                    >
                      <ProviderAvatar
                        icon={provider.icon}
                        id={provider.id}
                        name={provider.name}
                      />
                      <span className="line-clamp-1 grow">{provider.name}</span>
                      {provider.websiteURL
                        ? (
                          <Link
                            aria-label={`Open ${provider.name} website`}
                            className="text-muted-foreground/80 hover:text-foreground shrink-0"
                            href={provider.websiteURL}
                            onClick={event => { event.stopPropagation(); }}
                            onMouseDown={event => { event.stopPropagation(); }}
                            onPointerDown={event => { event.stopPropagation(); }}
                          >
                            <ExternalLink className="size-2.5" />
                          </Link>
                        )
                        : null}
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

function ProviderListItem({
  provider,
  selected,
  onSelect
}: {
  readonly onSelect: () => void;
  readonly provider: ModelProviderGroup;
  readonly selected: boolean;
}) {
  const removeProvider = useRemoveProvider();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div
      aria-label={`Select ${provider.name} provider`}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
        selected ? "bg-muted font-medium" : "hover:bg-muted/50"
      )}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <ProviderAvatar
        icon={provider.icon}
        id={provider.id}
        name={provider.name}
      />
      <span className="line-clamp-1 grow">{provider.name}</span>

      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            aria-label={`${provider.name} provider actions`}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            )}
            onClick={e => { e.stopPropagation(); }}
            role="button"
            tabIndex={0}
            title={`${provider.name} provider actions`}
          >
            <MoreHorizontal className="size-4" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={e => { e.stopPropagation(); }}>
          <DropdownMenuItem
            onSelect={() => { setConfirmOpen(true); }}
            variant="destructive"
          >
            <Trash2 />
            Remove {provider.name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        confirmLabel="Remove"
        description={`This removes ${provider.name} from your configured providers. You can add it back later.`}
        dimBackground={false}
        onConfirm={() => {
          setConfirmOpen(false);
          void removeProvider(provider.id);
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title={`Remove ${provider.name}?`}
      />
    </div>
  );
}

function ProviderEditor({ provider }: { readonly provider: ModelProviderGroup | null; }) {
  const updateProvider = useUpdateProvider();
  const setModelEnabled = useSetModelEnabled();
  const setAllModelsEnabled = useSetAllModelsEnabled();
  const [iconDraft, setIconDraft] = useState(provider?.icon ?? "");
  const [baseUrlEnabled, setBaseUrlEnabled] = useState(
    Boolean(provider?.baseUrl)
  );
  const [modelView, setModelView] = useState<"all" | "disabled" | "enabled">(
    "all"
  );
  const [apiValue, setApiValue] = useState<CustomProviderApi>(
    DEFAULT_CUSTOM_PROVIDER_API
  );
  const [modelListRef] = useAutoAnimation<HTMLDivElement>();
  const [editorOpen, setEditorOpen] = useState(false);
  // The custom model being edited, or `null` for a fresh create.
  const [editingModel, setEditingModel] = useState<CustomModel | null>(null);

  const openCreateModel = () => {
    setEditingModel(null);
    setEditorOpen(true);
  };

  const openEditModel = (model: CustomModel) => {
    setEditingModel(model);
    setEditorOpen(true);
  };

  const disabledModels = useMemo(
    () => new Set(provider?.disabledModels ?? []),
    [provider]
  );

  const customModels = useMemo(
    () => new Set(provider?.customModels ?? []),
    [provider]
  );

  useEffect(() => {
    setApiValue(provider?.api ?? DEFAULT_CUSTOM_PROVIDER_API);
  }, [provider?.api, provider?.id]);

  // Persist on blur, but only when the value actually changed. An empty field
  // clears the key (stored as `null`).
  const handleApiKeyBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!provider) { return; }
    const value = event.target.value.trim();
    const next = value === "" ? null : value;
    const current = provider.apiKey ?? null;
    if (next !== current) {
      void updateProvider(provider.id, { apiKey: next });
    }
  };

  const handleNameBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!provider) { return; }
    const value = event.target.value.trim();
    if (value === "" || value === provider.name) {
      return;
    }
    void updateProvider(provider.id, { name: value });
  };

  const handleApiChange = (api: CustomProviderApi) => {
    if (!provider) {
      return;
    }
    const previous = apiValue;
    setApiValue(api);
    if (api === previous) {
      return;
    }
    void updateProvider(provider.id, { api }).catch(error => {
      setApiValue(previous);
      toast.error("Failed to update API type", {
        description:
          error instanceof Error ? error.message : "Please try again."
      });
    });
  };

  // Persist the icon override on blur when changed. Empty ⇒ auto-resolve.
  const handleIconBlur = () => {
    if (!provider) { return; }
    const value = iconDraft.trim();
    const next = value === "" ? null : value;
    const current = provider.icon ?? null;
    if (next !== current) {
      void updateProvider(provider.id, { icon: next });
    }
  };

  // Persist the custom base URL on blur when changed. Empty ⇒ use the default.
  const handleBaseUrlBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!provider) { return; }
    const value = event.target.value.trim();
    const next = value === "" ? null : value;
    const current = provider.baseUrl ?? null;
    if (next !== current) {
      void updateProvider(provider.id, { baseUrl: next });
    }
  };

  // The switch reveals/hides the base URL input; turning it off clears the
  // stored value (⇒ use the provider default).
  const handleBaseUrlToggle = (enabled: boolean) => {
    setBaseUrlEnabled(enabled);
    if (!enabled && provider) {
      void updateProvider(provider.id, { baseUrl: null });
    }
  };

  if (!provider) {
    return (
      <div className="text-muted-foreground flex min-w-0 grow items-center justify-center text-sm">
        Select or add a provider from the left sidebar
      </div>
    );
  }

  const totalModels = provider.models.length;
  const enabledModels = provider.models.filter(
    model => !disabledModels.has(model.id)
  ).length;

  const visibleModels = provider.models.filter(model => {
    if (modelView === "enabled") { return !disabledModels.has(model.id); }
    if (modelView === "disabled") { return disabledModels.has(model.id); }
    return true;
  });
  const isBuiltin = provider.builtin === true;

  // Which base-URL convention applies (see ANTHROPIC_BASE_URL_HINT): builtin
  // providers are recognized by their models' API; custom providers follow the
  // live API type selection.
  const usesAnthropicApi = isBuiltin
    ? provider.models.some(model => model.api === "anthropic-messages")
    : apiValue === "anthropic-messages";
  const baseUrlPlaceholder = usesAnthropicApi
    ? "https://api.example.com"
    : "https://api.example.com/v1";

  return (
    <div className="flex min-w-0 grow flex-col">
      <ScrollArea className="min-h-0 grow">
        <div className="flex flex-col gap-6 pr-4 pl-6">
          <div className="flex items-center gap-2">
            {isBuiltin && provider.websiteLink
              ? (
                <Tooltip content={`Learn more about ${provider.name}`}>
                  <Link
                    aria-label={`Open ${provider.name} website`}
                    className="group/provider-link text-foreground hover:text-foreground flex items-center gap-2"
                    href={provider.websiteLink}
                  >
                    <h3 className="font-heading text-lg font-medium">
                      {provider.name}
                    </h3>
                    <ExternalLink className="text-muted-foreground group-hover/provider-link:text-foreground size-4 transition-colors" />
                  </Link>
                </Tooltip>
              )
              : (
                <h3 className="font-heading text-lg font-medium">
                  {provider.name}
                </h3>
              )}
          </div>

          {!isBuiltin && (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Name</span>
                <Input
                  aria-label="Custom provider name"
                  defaultValue={provider.name}
                  onBlur={handleNameBlur}
                  placeholder="Custom provider"
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">API type</span>
                <Select
                  onValueChange={value => { handleApiChange(value as CustomProviderApi); }}
                  value={apiValue}
                >
                  <SelectTrigger
                    aria-label={`${provider.name} API type`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_PROVIDER_API_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {!isBuiltin && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Icon</span>
              <div className="flex items-center gap-2">
                <ProviderAvatar
                  icon={iconDraft.trim() || undefined}
                  id={provider.id}
                  name={provider.name}
                />
                <Input
                  aria-label={`${provider.name} icon`}
                  onBlur={handleIconBlur}
                  onChange={e => { setIconDraft(e.target.value); }}
                  placeholder="Auto (e.g. openai, anthropic, google)"
                  value={iconDraft}
                />
              </div>
              <div className="text-muted-foreground text-xs">
                A{" "}
                <Link
                  className="underline underline-offset-2"
                  href="https://icons.lobehub.com"
                >
                  @lobehub/icons
                </Link>{" "}
                keyword. Leave blank to auto-resolve from the provider name.
              </div>
            </div>
          )}

          {provider.id !== "openai-codex" && (
            <ApiKeyField
              aria-label={`${provider.name} API key`}
              defaultValue={provider.apiKey ?? ""}
              description={
                <div className="text-muted-foreground pl-5 text-xs">
                  <div className="list-item">
                    {
                      'Use "${ENV_NAME}" to reference environment variables. e.g. "$OPENAI_API_KEY"'
                    }
                  </div>
                  <div className="list-item">
                    Leave it blank to use the official {provider.name}{" "}
                    environment variable
                  </div>
                </div>
              }
              getKeyUrl={provider.websiteLink}
              label="API key"
              onBlur={handleApiKeyBlur}
              placeholder={`Input API Key for ${provider.name}.`}
            />
          )}

          {isBuiltin
            ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Custom base URL</span>
                  <Switch
                    aria-label={
                      baseUrlEnabled
                        ? `Disable custom base URL for ${provider.name}`
                        : `Enable custom base URL for ${provider.name}`
                    }
                    checked={baseUrlEnabled}
                    onCheckedChange={handleBaseUrlToggle}
                  />
                </div>
                {baseUrlEnabled
                  ? (
                    <>
                      <Input
                        aria-label={`${provider.name} custom base URL`}
                        defaultValue={provider.baseUrl ?? ""}
                        onBlur={handleBaseUrlBlur}
                        placeholder={baseUrlPlaceholder}
                      />
                      <div className="text-muted-foreground text-xs">
                        Leave empty to use the default endpoint.
                        {usesAnthropicApi ? ` ${ANTHROPIC_BASE_URL_HINT}` : null}
                      </div>
                    </>
                  )
                  : null}
              </div>
            )
            : (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Base URL</span>
                <Input
                  aria-label={`${provider.name} base URL`}
                  defaultValue={provider.baseUrl ?? ""}
                  onBlur={handleBaseUrlBlur}
                  placeholder={baseUrlPlaceholder}
                  required
                />
                {usesAnthropicApi
                  ? (
                    <div className="text-muted-foreground text-xs">
                      {ANTHROPIC_BASE_URL_HINT}
                    </div>
                  )
                  : null}
              </div>
            )}

          {!isBuiltin && <ProviderHeadersEditor provider={provider} />}

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Models</span>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                {enabledModels === totalModels
                  ? totalModels
                  : `${enabledModels}/${totalModels}`}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Tooltip content="Add custom model">
                  <button
                    aria-label="Add custom model"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
                    onClick={openCreateModel}
                    type="button"
                  >
                    <Plus className="size-4" />
                  </button>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Model list actions for ${provider.name}`}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
                      type="button"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onSelect={() =>
                        void setAllModelsEnabled(provider.id, false)}
                    >
                      <Ban />
                      Disable All
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void setAllModelsEnabled(provider.id, true)}
                    >
                      <CheckCheck />
                      Enable All
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {(
                      [
                        ["enabled", "Show Enabled Only"],
                        ["disabled", "Show Disabled Only"],
                        ["all", "Show All"]
                      ] as const
                    ).map(([value, label]) => (
                      <DropdownMenuItem
                        key={value}
                        onSelect={() => { setModelView(value); }}
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            modelView !== value && "invisible"
                          )}
                        />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex flex-col gap-1.5" ref={modelListRef}>
              {visibleModels.length === 0
                ? (
                  <div className="text-muted-foreground px-1 py-2 text-xs">
                    No models to show.
                  </div>
                )
                : (
                  visibleModels.map(model => (
                    <ModelListItem
                      enabled={!disabledModels.has(model.id)}
                      isCustom={customModels.has(model.id)}
                      key={model.id}
                      model={model}
                      onEdit={() => { openEditModel(model); }}
                      onToggle={next =>
                        void setModelEnabled(provider.id, model.id, next)}
                      providerId={provider.id}
                      providerName={provider.name}
                    />
                  ))
                )}
            </div>
          </div>
        </div>
      </ScrollArea>

      <ModelEditorDialog
        model={editingModel}
        onOpenChange={setEditorOpen}
        open={editorOpen}
        providerApi={isBuiltin ? undefined : apiValue}
        providerId={provider.id}
      />
    </div>
  );
}

/**
 * Key-value editor for a custom provider's extra HTTP headers. Rows live in
 * local state so half-typed entries survive re-renders; only rows with a
 * non-empty name are persisted, on blur or row removal.
 */
function ProviderHeadersEditor({ provider }: { readonly provider: ModelProviderGroup; }) {
  const updateProvider = useUpdateProvider();
  const [rows, setRows] = useState<Array<{ key: string; value: string; }>>(() =>
    Object.entries(provider.headers ?? {}).map(([key, value]) => ({
      key,
      value
    })));

  const setRow = (index: number, row: { key: string; value: string; }) => {
    setRows(prev => prev.map((r, i) => (i === index ? row : r)));
  };

  // Persist the named rows when they differ from the stored headers. An empty
  // set clears the field (stored as `null`).
  const persist = (nextRows: Array<{ key: string; value: string; }>) => {
    const headers: Record<string, string> = {};
    for (const row of nextRows) {
      const key = row.key.trim();
      if (key !== "") { headers[key] = row.value; }
    }
    const current = provider.headers ?? {};
    const currentKeys = Object.keys(current);
    const same =
      Object.keys(headers).length === currentKeys.length
      && currentKeys.every(key => headers[key] === current[key]);
    if (same) { return; }
    void updateProvider(provider.id, {
      headers: Object.keys(headers).length > 0 ? headers : null
    });
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);
    persist(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Custom headers</span>
      {rows.map((row, index) => (
        <div className="flex items-center gap-2" key={index}>
          <Input
            aria-label={`${provider.name} header ${index + 1} name`}
            onBlur={() => { persist(rows); }}
            onChange={e => { setRow(index, { ...row, key: e.target.value }); }}
            placeholder="X-Header-Name"
            value={row.key}
          />
          <Input
            aria-label={`${provider.name} header ${index + 1} value`}
            onBlur={() => { persist(rows); }}
            onChange={e => { setRow(index, { ...row, value: e.target.value }); }}
            placeholder="Value"
            value={row.value}
          />
          <Tooltip content="Remove header">
            <button
              aria-label={`Remove header ${index + 1}`}
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors"
              onClick={() => { removeRow(index); }}
              type="button"
            >
              <Trash2 className="size-4" />
            </button>
          </Tooltip>
        </div>
      ))}
      <Button
        className="self-start"
        onClick={() => { setRows(prev => [...prev, { key: "", value: "" }]); }}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus /> Add header
      </Button>
      <div className="text-muted-foreground text-xs">
        Sent with every request to this provider.
      </div>
    </div>
  );
}

/**
 * A single model row. Custom (user-added) models get a hover-revealed action
 * cluster — edit and delete — to the left of the enable switch. Delete is gated
 * behind a confirmation.
 */
function ModelListItem({
  providerId,
  providerName,
  model,
  enabled,
  isCustom,
  onToggle,
  onEdit
}: {
  readonly enabled: boolean;
  readonly isCustom: boolean;
  readonly model: ModelProviderGroup["models"][number];
  readonly onEdit: () => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly providerId: string;
  readonly providerName: string;
}) {
  const removeCustomModel = useRemoveCustomModel();
  const testModelConnection = useTestModelConnection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await testModelConnection(providerId, model.id);
      toast.success("Model connected successfully", {
        description: model.name
      });
    } catch (error) {
      toast.error("Failed to connect to model", {
        description:
          error instanceof Error ? error.message : "Please try again."
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Item className="group" size="sm" variant="muted">
      <ItemMedia>
        <ModelAvatar
          icon={model.icon}
          id={model.id}
          name={model.name}
          size={20}
        />
      </ItemMedia>
      <ItemContent className={cn(!enabled && "opacity-50")}>
        <ItemTitle className="font-mono">{model.name}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip content="Test connection">
            <button
              aria-label={`Test connection for ${model.name}`}
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
              disabled={testing}
              onClick={() => void handleTestConnection()}
              type="button"
            >
              {testing
                ? (
                  <Loader2 className="size-3.5 animate-spin" />
                )
                : (
                  <CableIcon className="size-3.5" />
                )}
            </button>
          </Tooltip>
          {isCustom
            ? (
              <>
                <button
                  aria-label={`Edit ${model.name}`}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
                  onClick={onEdit}
                  type="button"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  aria-label={`Delete ${model.name}`}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-6 items-center justify-center rounded transition-colors"
                  onClick={() => { setConfirmOpen(true); }}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )
            : null}
        </div>
        <Switch
          aria-label={
            enabled ? `Disable ${model.name}` : `Enable ${model.name}`
          }
          checked={enabled}
          onCheckedChange={onToggle}
          size="sm"
        />
      </ItemActions>
      {isCustom
        ? (
          <ConfirmDialog
            confirmLabel="Delete"
            description={`This permanently removes the custom model "${model.name}" from ${providerName}.`}
            dimBackground={false}
            onConfirm={() => {
              setConfirmOpen(false);
              void removeCustomModel(providerId, model.id);
            }}
            onOpenChange={setConfirmOpen}
            open={confirmOpen}
            title={`Delete ${model.name}?`}
          />
        )
        : null}
    </Item>
  );
}
