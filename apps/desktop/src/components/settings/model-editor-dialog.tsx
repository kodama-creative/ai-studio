"use client";

import { CableIcon, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { CustomModel } from "@llm-space/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CUSTOM_PROVIDER_API_TYPES,
  type CustomProviderApi,
  DEFAULT_CUSTOM_PROVIDER_API,
  isCustomProviderApi
} from "./custom-provider-api";
import {
  useTestModelConnection,
  useUpdateProvider,
  useUpsertCustomModel
} from "../model-provider";
import { ModelAvatar } from "../thread-playground/model-avatar";

const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 131072;

interface FormState {
  id: string;
  name: string;
  icon: string;
  api: CustomProviderApi;
  reasoning: boolean;
  deepseekThinking: boolean;
  image: boolean;
  contextWindow: number;
  maxTokens: number;
}

function initialState(
  model: CustomModel | null | undefined,
  api: CustomProviderApi = DEFAULT_CUSTOM_PROVIDER_API
): FormState {
  if (!model) {
    return {
      id: "",
      name: "",
      icon: "",
      api,
      reasoning: false,
      deepseekThinking: false,
      image: false,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS
    };
  }
  return {
    id: model.id,
    name: model.name,
    icon: model.icon ?? "",
    api: isCustomProviderApi(model.api) ? model.api : api,
    reasoning: model.reasoning,
    deepseekThinking:
      (model.compat as { thinkingFormat?: string; } | undefined)
        ?.thinkingFormat === "deepseek",
    image: model.input.includes("image"),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  };
}

/**
 * Create or edit a provider's custom model. `model` present ⇒ edit mode (its id
 * is passed as `originalId` so a rename replaces the old entry). Only the fields
 * a user cares about are exposed; the rest (`cost`, `compat.supportsDeveloperRole`)
 * get sensible defaults.
 */
export function ModelEditorDialog({
  open,
  onOpenChange,
  providerId,
  providerApi,
  model
}: {
  readonly model?: CustomModel | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly providerApi?: CustomProviderApi;
  readonly providerId: string;
}) {
  const updateProvider = useUpdateProvider();
  const upsertCustomModel = useUpsertCustomModel();
  const testModelConnection = useTestModelConnection();
  const [form, setForm] = useState<FormState>(() =>
    initialState(model, providerApi));
  const [testing, setTesting] = useState(false);

  // Reset the form whenever the dialog opens (for a fresh create or a different
  // model to edit).
  useEffect(() => {
    if (open) {
      setForm(initialState(model, providerApi));
    }
  }, [open, model, providerApi]);

  const isEdit = Boolean(model);

  // Editing the id also updates the name while the two are still "linked" — the
  // name is empty or still mirrors the id. Editing the name never touches the id.
  const handleIdChange = (nextId: string) => {
    setForm(prev => ({
      ...prev,
      id: nextId,
      name: prev.name === "" || prev.name === prev.id ? nextId : prev.name
    }));
  };

  const trimmedId = form.id.trim();
  const canSave = trimmedId.length > 0;

  // Assemble the model config from the current form values. Shared by Save and
  // Test so the connection test verifies exactly what would be persisted.
  const buildModel = (): CustomModel => {
    const trimmedIcon = form.icon.trim();
    return {
      id: trimmedId,
      name: form.name.trim() || trimmedId,
      ...(trimmedIcon ? { icon: trimmedIcon } : {}),
      api: form.api,
      reasoning: form.reasoning,
      input: form.image ? ["text", "image"] : ["text"],
      contextWindow: form.contextWindow,
      maxTokens: form.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsDeveloperRole: false,
        ...(form.reasoning && form.deepseekThinking
          ? { thinkingFormat: "deepseek" }
          : {})
      }
    };
  };

  const handleSave = () => {
    if (!canSave) { return; }
    const built = buildModel();
    void (async () => {
      if (providerApi && form.api !== providerApi) {
        await updateProvider(providerId, { api: form.api });
      }
      await upsertCustomModel(providerId, built, model?.id);
    })();
    onOpenChange(false);
  };

  // Test the current form values without persisting them, reusing the same
  // provider-connection check as the model list's per-model test button.
  const handleTest = async () => {
    if (!canSave) { return; }
    setTesting(true);
    try {
      await testModelConnection(providerId, trimmedId, buildModel());
      toast.success("Model connected successfully", {
        description: form.name.trim() || trimmedId
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-md"
        onInteractOutside={e => { e.preventDefault(); }}
        onPointerDownOutside={e => { e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit model" : "Add custom model"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this custom model's configuration."
              : "Define a custom model for this provider."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Model ID">
            <Input
              onChange={e => { handleIdChange(e.target.value); }}
              placeholder="deepseek-v4-pro"
              value={form.id}
            />
          </Field>

          <Field label="Model name">
            <Input
              onChange={e => { setForm(prev => ({ ...prev, name: e.target.value })); }}
              placeholder="DeepSeek V4 Pro"
              value={form.name}
            />
          </Field>

          <Field label="Icon">
            <div className="flex items-center gap-2">
              <ModelAvatar
                icon={form.icon.trim() || undefined}
                id={form.id.trim() || "model"}
                name={form.name.trim() || form.id.trim() || "Model"}
              />
              <Input
                onChange={e => { setForm(prev => ({ ...prev, icon: e.target.value })); }}
                placeholder="Auto (e.g. openai, claude, deepseek)"
                value={form.icon}
              />
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">
              A{" "}
              <a
                className="underline underline-offset-2"
                href="https://icons.lobehub.com"
                rel="noreferrer"
                target="_blank"
              >
                @lobehub/icons
              </a>{" "}
              keyword. Leave blank to auto-resolve from the model ID.
            </p>
          </Field>

          <Field label="API type">
            <Select
              onValueChange={value => {
                setForm(prev => ({
                  ...prev,
                  api: value as CustomProviderApi
                }));
              }}
              value={form.api}
            >
              <SelectTrigger className="w-full">
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
          </Field>

          <ToggleField
            checked={form.reasoning}
            label="Reasoning supported"
            onCheckedChange={checked => { setForm(prev => ({ ...prev, reasoning: checked })); }}
          />

          {form.reasoning
            ? (
              <ToggleField
                checked={form.deepseekThinking}
                label="Use DeepSeek thinking format"
                onCheckedChange={checked => { setForm(prev => ({ ...prev, deepseekThinking: checked })); }}
              />
            )
            : null}

          <ToggleField
            checked={form.image}
            label="Image supported"
            onCheckedChange={checked => { setForm(prev => ({ ...prev, image: checked })); }}
          />

          <div className="flex gap-4">
            <Field className="flex-1" label="Context window">
              <Input
                min={1}
                onChange={e => {
                  setForm(prev => ({
                    ...prev,
                    contextWindow:
                      Number(e.target.value) || DEFAULT_CONTEXT_WINDOW
                  }));
                }}
                type="number"
                value={form.contextWindow}
              />
            </Field>
            <Field className="flex-1" label="Max tokens">
              <Input
                min={1}
                onChange={e => {
                  setForm(prev => ({
                    ...prev,
                    maxTokens: Number(e.target.value) || DEFAULT_MAX_TOKENS
                  }));
                }}
                type="number"
                value={form.maxTokens}
              />
            </Field>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            disabled={!canSave || testing}
            onClick={() => void handleTest()}
            variant="outline"
          >
            {testing
              ? (
                <Loader2 className="size-4 animate-spin" />
              )
              : (
                <CableIcon className="size-4" />
              )}
            Test
          </Button>
          <div className="flex gap-2">
            <Button onClick={() => { onOpenChange(false); }} variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={handleSave}>
              {isEdit ? "Save" : "Add"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly label: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium">{label}</label>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
