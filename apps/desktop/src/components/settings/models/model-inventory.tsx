"use client";

import {
  getArkImageModelDefinitions,
  type ModelProviderGroup,
  type SeedreamImageModelDefinition,
} from "@llm-space/core";
import { ConfirmDialog } from "@llm-space/ui/components/confirm-dialog";
import {
  useRemoveCustomImageModel,
  useRemoveCustomModel,
  useSetAllImageModelsEnabled,
  useSetImageModelEnabled,
  useTestModelConnection,
} from "@llm-space/ui/components/model-provider";
import { ModelAvatar } from "@llm-space/ui/components/thread-playground/model-avatar";
import { Tooltip } from "@llm-space/ui/components/tooltip";
import { useAutoAnimation } from "@llm-space/ui/lib/use-auto-animation";
import { cn } from "@llm-space/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@llm-space/ui/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@llm-space/ui/ui/item";
import { Switch } from "@llm-space/ui/ui/switch";
import {
  Ban,
  CableIcon,
  Check,
  CheckCheck,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ImageModelEditorDialog } from "./image-model-editor-dialog";
import { runModelMutation } from "./run-model-mutation";

export function ArkImageGenerationEditor({
  provider,
}: {
  provider: ModelProviderGroup;
}) {
  const setImageModelEnabled = useSetImageModelEnabled();
  const setAllImageModelsEnabled = useSetAllImageModelsEnabled();
  const removeCustomImageModel = useRemoveCustomImageModel();
  const config = provider.imageGeneration ?? {};
  const models = getArkImageModelDefinitions(config);
  const disabledModels = new Set(config.disabledModels ?? []);
  const enabledModels = models.filter((model) => !disabledModels.has(model.id));
  const customModels = new Set((config.models ?? []).map((model) => model.id));
  const [modelView, setModelView] = useState<"all" | "enabled" | "disabled">(
    "all"
  );
  const [modelListRef] = useAutoAnimation<HTMLDivElement>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] =
    useState<SeedreamImageModelDefinition | null>(null);

  const visibleModels = models.filter((model) => {
    if (modelView === "enabled") return !disabledModels.has(model.id);
    if (modelView === "disabled") return disabledModels.has(model.id);
    return true;
  });

  /** Enable or disable one image model without changing Thread tool bindings. */
  const handleModelEnabled = (modelId: string, enabled: boolean) => {
    runModelMutation(
      `Failed to ${enabled ? "enable" : "disable"} image model`,
      () => setImageModelEnabled(modelId, enabled)
    );
  };

  /** Apply the existing list-wide enable policy to every image model. */
  const handleAllModelsEnabled = (enabled: boolean) => {
    runModelMutation(
      `Failed to ${enabled ? "enable" : "disable"} image models`,
      () => setAllImageModelsEnabled(enabled)
    );
  };

  /** Remove one custom image model without repairing Thread tool bindings. */
  const handleDeleteCustomModel = (modelId: string) => {
    runModelMutation("Failed to delete custom image model", () =>
      removeCustomImageModel(modelId)
    );
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Image models</span>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {enabledModels.length === models.length
              ? models.length
              : `${enabledModels.length}/${models.length}`}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip content="Add custom image model">
              <button
                type="button"
                aria-label="Add custom image model"
                onClick={() => {
                  setEditingModel(null);
                  setEditorOpen(true);
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
              >
                <Plus className="size-4" />
              </button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Image model list actions for ${provider.name}`}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onSelect={() => handleAllModelsEnabled(false)}
                >
                  <Ban />
                  Disable All
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleAllModelsEnabled(true)}>
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
              No image models to show.
            </div>
          ) : (
            visibleModels.map((model) => (
              <_ImageModelListItem
                key={model.id}
                providerName={provider.name}
                model={model}
                enabled={!disabledModels.has(model.id)}
                isCustom={customModels.has(model.id)}
                onToggle={(enabled) => handleModelEnabled(model.id, enabled)}
                onEdit={() => {
                  setEditingModel(model);
                  setEditorOpen(true);
                }}
                onDelete={() => handleDeleteCustomModel(model.id)}
              />
            ))
          )}
        </div>
      </div>

      <ImageModelEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        model={editingModel}
        existingIds={models.map((model) => model.id)}
      />
    </>
  );
}

/** Image-model row matching the existing Chat model management interaction. */
function _ImageModelListItem({
  providerName,
  model,
  enabled,
  isCustom,
  onToggle,
  onEdit,
  onDelete,
}: {
  providerName: string;
  model: SeedreamImageModelDefinition;
  enabled: boolean;
  isCustom: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Item variant="muted" size="sm" className="group">
      <ItemMedia>
        <ModelAvatar
          id={model.id}
          name={model.name}
          icon={model.icon}
          size={20}
        />
      </ItemMedia>
      <ItemContent className={cn(!enabled && "opacity-50")}>
        <ItemTitle className="font-mono">{model.name}</ItemTitle>
      </ItemContent>
      <ItemActions>
        {isCustom && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              aria-label={`Edit ${model.name}`}
              onClick={onEdit}
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${model.name}`}
              onClick={() => setConfirmOpen(true)}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-6 items-center justify-center rounded transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
        <Switch
          size="sm"
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={
            enabled ? `Disable ${model.name}` : `Enable ${model.name}`
          }
        />
      </ItemActions>
      {isCustom && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete ${model.name}?`}
          description={`This permanently removes the custom image model "${model.name}" from ${providerName}.`}
          confirmLabel="Delete"
          dimBackground={false}
          onConfirm={() => {
            setConfirmOpen(false);
            onDelete();
          }}
        />
      )}
    </Item>
  );
}

/**
 * A single model row. Custom (user-added) models get a hover-revealed action
 * cluster — edit and delete — to the left of the enable switch. Delete is gated
 * behind a confirmation.
 */
export function ModelListItem({
  providerId,
  providerName,
  profileId,
  model,
  enabled,
  isCustom,
  onToggle,
  onEdit,
}: {
  providerId: string;
  providerName: string;
  profileId: string;
  model: ModelProviderGroup["models"][number];
  enabled: boolean;
  isCustom: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
}) {
  const removeCustomModel = useRemoveCustomModel();
  const testModelConnection = useTestModelConnection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await testModelConnection(providerId, model.id, undefined, profileId);
      toast.success("Model connected successfully", {
        description: model.name,
      });
    } catch (error) {
      toast.error("Failed to connect to model", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Item variant="muted" size="sm" className="group">
      <ItemMedia>
        <ModelAvatar
          id={model.id}
          name={model.name}
          icon={model.icon}
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
              type="button"
              aria-label={`Test connection for ${model.name}`}
              disabled={testing}
              onClick={() => void handleTestConnection()}
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
            >
              {testing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CableIcon className="size-3.5" />
              )}
            </button>
          </Tooltip>
          {isCustom && (
            <>
              <button
                type="button"
                aria-label={`Edit ${model.name}`}
                onClick={onEdit}
                className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${model.name}`}
                onClick={() => setConfirmOpen(true)}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-6 items-center justify-center rounded transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
        <Switch
          size="sm"
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={
            enabled ? `Disable ${model.name}` : `Enable ${model.name}`
          }
        />
      </ItemActions>
      {isCustom && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete ${model.name}?`}
          description={`This permanently removes the custom model "${model.name}" from ${providerName}.`}
          confirmLabel="Delete"
          dimBackground={false}
          onConfirm={() => {
            setConfirmOpen(false);
            runModelMutation(`Failed to delete ${model.name}`, () =>
              removeCustomModel(providerId, model.id)
            );
          }}
        />
      )}
    </Item>
  );
}
