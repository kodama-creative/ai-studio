"use client";

import {
  formatProviderProfileLabel,
  type CustomModel,
  type ModelProviderGroup,
} from "@llm-space/core";
import { ConfirmDialog } from "@llm-space/ui/components/confirm-dialog";
import { Link } from "@llm-space/ui/components/link";
import {
  useSetAllModelsEnabled,
  useSetModelEnabled,
} from "@llm-space/ui/components/model-provider";
import { ProviderAvatar } from "@llm-space/ui/components/thread-playground/provider-avatar";
import { Tooltip } from "@llm-space/ui/components/tooltip";
import { useAutoAnimation } from "@llm-space/ui/lib/use-auto-animation";
import { cn } from "@llm-space/ui/lib/utils";
import { Button } from "@llm-space/ui/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@llm-space/ui/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@llm-space/ui/ui/dropdown-menu";
import { Input } from "@llm-space/ui/ui/input";
import { ScrollArea } from "@llm-space/ui/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@llm-space/ui/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@llm-space/ui/ui/tabs";
import {
  Ban,
  Check,
  CheckCheck,
  ExternalLink,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { ModelsSettingsController } from "@/app/settings/models/models-settings-controller";

import {
  CUSTOM_PROVIDER_API_TYPES,
  type CustomProviderApi,
} from "./custom-provider-api";
import { ModelEditorDialog } from "./model-editor-dialog";
import {
  ArkImageGenerationEditor,
  ModelListItem,
} from "./model-inventory";
import { ProviderProfileEditor } from "./provider-profile-editor";
import { runModelMutation } from "./run-model-mutation";

export function ProviderEditor({
  controller,
  provider,
}: {
  controller: ModelsSettingsController;
  provider: ModelProviderGroup | null;
}) {
  const setModelEnabled = useSetModelEnabled();
  const setAllModelsEnabled = useSetAllModelsEnabled();
  const [modelView, setModelView] = useState<"all" | "enabled" | "disabled">(
    "all"
  );
  const metadataController = controller.metadata;
  const profilesController = controller.profiles;
  const metadata = useSyncExternalStore(
    metadataController.subscribe,
    metadataController.getSnapshot,
    metadataController.getSnapshot
  );
  const profilesState = useSyncExternalStore(
    profilesController.subscribe,
    profilesController.getSnapshot,
    profilesController.getSnapshot
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

  if (!provider) {
    return (
      <div className="text-muted-foreground flex min-w-0 grow items-center justify-center text-sm">
        Select or add a provider from the left sidebar
      </div>
    );
  }

  const totalModels = provider.models.length;
  const enabledModels = provider.models.filter(
    (model) => !disabledModels.has(model.id)
  ).length;

  const visibleModels = provider.models.filter((model) => {
    if (modelView === "enabled") return !disabledModels.has(model.id);
    if (modelView === "disabled") return disabledModels.has(model.id);
    return true;
  });
  const isBuiltin = provider.builtin === true;
  const selectedProfile =
    provider.profiles.find(
      (profile) => profile.id === profilesState.selectedProfileId
    ) ??
    provider.profiles[0];
  const profilePendingRemoval = provider.profiles.find(
    (profile) => profile.id === profilesState.removalCandidateId
  );

  // Builtin providers derive their base-URL convention from model APIs; custom
  // providers follow the live API type selection.
  const usesAnthropicApi = isBuiltin
    ? provider.models.some((model) => model.api === "anthropic-messages")
    : metadata.api === "anthropic-messages";
  return (
    <div className="flex min-w-0 grow flex-col">
      <ScrollArea className="min-h-0 grow">
        <div className="flex flex-col gap-6 pr-4 pl-6">
          <div className="flex items-center gap-2">
            {isBuiltin && provider.websiteLink ? (
              <Tooltip content={`Learn more about ${provider.name}`}>
                <Link
                  href={provider.websiteLink}
                  aria-label={`Open ${provider.name} website`}
                  className="group/provider-link text-foreground hover:text-foreground flex items-center gap-2"
                >
                  <h3 className="font-heading text-lg font-medium">
                    {provider.name}
                  </h3>
                  <ExternalLink className="text-muted-foreground group-hover/provider-link:text-foreground size-4 transition-colors" />
                </Link>
              </Tooltip>
            ) : (
              <h3 className="font-heading text-lg font-medium">
                {provider.name}
              </h3>
            )}
          </div>

          {!isBuiltin && (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Provider name</span>
                <Input
                  value={metadata.name}
                  placeholder="Custom provider"
                  aria-label="Custom provider name"
                  onChange={(event) =>
                    metadataController.draft("name", event.target.value)
                  }
                  onBlur={() => metadataController.commit("name")}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">API type</span>
                <Select
                  value={metadata.api}
                  onValueChange={(value) =>
                    metadataController.selectApi(value as CustomProviderApi)
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`${provider.name} API type`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {CUSTOM_PROVIDER_API_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
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
                  id={provider.id}
                  name={provider.name}
                  icon={metadata.icon.trim() || undefined}
                />
                <Input
                  value={metadata.icon}
                  placeholder="Auto (e.g. openai, anthropic, google)"
                  aria-label={`${provider.name} icon`}
                  onChange={(event) =>
                    metadataController.draft("icon", event.target.value)
                  }
                  onBlur={() => metadataController.commit("icon")}
                />
              </div>
              <div className="text-muted-foreground text-xs">
                A{" "}
                <Link
                  href="https://icons.lobehub.com"
                  className="underline underline-offset-2"
                >
                  @lobehub/icons
                </Link>{" "}
                keyword. Leave blank to auto-resolve from the provider name.
              </div>
            </div>
          )}

          <Tabs
            value={selectedProfile.id}
            onValueChange={(profileId) =>
              profilesController.select(profileId)
            }
            className="gap-3"
          >
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TabsList variant="line" className="h-8! min-w-0 grow flex-row! justify-start overflow-x-auto">
                  {provider.profiles.map((profile, index) => (
                    <div
                      key={profile.id}
                      className="flex shrink-0 items-center"
                    >
                      <TabsTrigger value={profile.id} className="w-auto!">
                        {formatProviderProfileLabel(profile, index)}
                      </TabsTrigger>
                      {index > 0 ? (
                        <Tooltip content={`Remove ${profile.name}`}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${profile.name} connection profile`}
                            disabled={profilesState.mutation !== null}
                            onClick={() =>
                              profilesController.requestRemove(profile.id)
                            }
                          >
                            <X data-icon="inline-start" />
                          </Button>
                        </Tooltip>
                      ) : null}
                    </div>
                  ))}
                </TabsList>
                <Tooltip content="Add connection profile">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Add connection profile"
                    disabled={profilesState.mutation !== null}
                    onClick={() => void profilesController.add()}
                  >
                    <Plus data-icon="inline-start" />
                  </Button>
                </Tooltip>
              </div>
            </div>

            {provider.profiles.map((profile, index) => (
              <TabsContent key={profile.id} value={profile.id}>
                <Card size="sm" className="bg-muted/30">
                  <CardHeader className="border-b">
                    <CardTitle>
                      {formatProviderProfileLabel(profile, index)}
                    </CardTitle>
                    <CardDescription>
                      API key, base URL, and headers for this connection.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {profile.id === selectedProfile.id ? (
                      <ProviderProfileEditor
                        controller={controller.profile}
                        provider={provider}
                        profile={profile}
                        isBuiltin={isBuiltin}
                        usesAnthropicApi={usesAnthropicApi}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {provider.id === "ark" ? "Chat models" : "Models"}
              </span>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                {enabledModels === totalModels
                  ? totalModels
                  : `${enabledModels}/${totalModels}`}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Tooltip content="Add custom model">
                  <button
                    type="button"
                    aria-label="Add custom model"
                    onClick={openCreateModel}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
                  >
                    <Plus className="size-4" />
                  </button>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Model list actions for ${provider.name}`}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onSelect={() =>
                        runModelMutation("Failed to disable models", () =>
                          setAllModelsEnabled(provider.id, false)
                        )
                      }
                    >
                      <Ban />
                      Disable All
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        runModelMutation("Failed to enable models", () =>
                          setAllModelsEnabled(provider.id, true)
                        )
                      }
                    >
                      <CheckCheck />
                      Enable All
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {(
                      [
                        ["enabled", "Show Enabled Only"],
                        ["disabled", "Show Disabled Only"],
                        ["all", "Show All"],
                      ] as const
                    ).map(([value, label]) => (
                      <DropdownMenuItem
                        key={value}
                        onSelect={() => setModelView(value)}
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
            <div ref={modelListRef} className="flex flex-col gap-1.5">
              {visibleModels.length === 0 ? (
                <div className="text-muted-foreground px-1 py-2 text-xs">
                  No models to show.
                </div>
              ) : (
                visibleModels.map((model) => (
                  <ModelListItem
                    key={model.id}
                    providerId={provider.id}
                    providerName={provider.name}
                    profileId={selectedProfile.id}
                    model={model}
                    enabled={!disabledModels.has(model.id)}
                    isCustom={customModels.has(model.id)}
                    onToggle={(next) =>
                      runModelMutation(
                        `Failed to ${next ? "enable" : "disable"} ${model.name}`,
                        () => setModelEnabled(provider.id, model.id, next)
                      )
                    }
                    onEdit={() => openEditModel(model)}
                  />
                ))
              )}
            </div>
          </div>

          {provider.id === "ark" && (
            <ArkImageGenerationEditor provider={provider} />
          )}
        </div>
      </ScrollArea>

      <ModelEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        providerId={provider.id}
        profileId={selectedProfile.id}
        providerApi={isBuiltin ? undefined : metadata.api}
        model={editingModel}
      />
      <ConfirmDialog
        open={profilePendingRemoval !== undefined}
        onOpenChange={(open) => {
          if (!open) profilesController.cancelRemove();
        }}
        title={`Remove ${profilePendingRemoval?.name ?? "profile"}?`}
        description={`This permanently removes the connection profile "${profilePendingRemoval?.name ?? "profile"}" from ${provider.name}.`}
        confirmLabel="Remove"
        dimBackground={false}
        onConfirm={() => void profilesController.confirmRemove()}
      />
    </div>
  );
}

/** Chat-model-parity inventory management for Ark image models. */
