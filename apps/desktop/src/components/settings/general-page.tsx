"use client";

import {
  isModelAvailable,
  useDefaultModel,
  useModels,
  useSetDefaultModel,
} from "@llm-space/ui/components/model-provider";
import {
  DEFAULT_PRIMARY,
  usePrimaryColor,
  useRenderingFidelity,
  useTheme,
  type RenderingFidelity,
  type Theme,
} from "@llm-space/ui/components/theme-provider";
import { ModelAvatar } from "@llm-space/ui/components/thread-playground/model-avatar";
import { Button } from "@llm-space/ui/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@llm-space/ui/ui/select";
import { Switch } from "@llm-space/ui/ui/switch";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";

import { useController } from "@/app/di/react";
import {
  ANALYTICS_SETTINGS_CONTROLLER,
  UPDATE_MODE_SETTINGS_CONTROLLER,
} from "@/app/di/settings-module";
import { runSettingsMutation } from "@/app/settings/run-settings-mutation";
import { useCommands } from "@/commands";
import type { AnalyticsStatus } from "@/shared/analytics";
import type { UpdateMode } from "@/shared/updates";

import { PrimaryColorPicker } from "./primary-color-picker";
import { SettingsPage } from "./settings-page";

/** Sentinel value for the "Automatic (first available model)" option. */
const AUTO_DEFAULT_MODEL = "__auto__";

/** A single label-on-the-left, control-on-the-right settings row. */
function SettingsRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-14 items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

/**
 * A titled category: an uppercase section label above a grouped card whose rows
 * are separated by hairline dividers. Gives the flat settings list hierarchy.
 */
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground px-1 text-[0.6875rem] font-medium tracking-wider uppercase">
        {title}
      </h3>
      <div className="border-border/60 divide-border/60 bg-muted/15 divide-y rounded-xl border px-4">
        {children}
      </div>
    </section>
  );
}

/** A row label with a title and an optional muted one-line explanation. */
function RowLabel({ title, hint }: { title: string; hint?: string }) {
  if (!hint) {
    return <>{title}</>;
  }
  return (
    <span className="flex flex-col gap-0.5">
      {title}
      <span className="text-muted-foreground text-xs">{hint}</span>
    </span>
  );
}

/**
 * Picks the app-wide default model. New threads — and threads whose saved model
 * is no longer available — resolve to it. "Automatic" clears the choice and
 * falls back to the first available model.
 */
function DefaultModelSelect() {
  const providers = useModels();
  const defaultModel = useDefaultModel();
  const setDefaultModel = useSetDefaultModel();

  const groups = useMemo(
    () =>
      [...providers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((group) => {
          const disabled = new Set(group.disabledModels ?? []);
          return {
            id: group.id,
            name: group.name,
            models: group.models.filter((model) => !disabled.has(model.id)),
          };
        })
        .filter((group) => group.models.length > 0),
    [providers]
  );

  // Show "Automatic" whenever nothing is chosen or the saved default is no
  // longer available, matching the resolution fallback.
  const value =
    defaultModel && isModelAvailable(providers, defaultModel)
      ? `${defaultModel.provider}:${defaultModel.id}`
      : AUTO_DEFAULT_MODEL;

  const handleChange = (next: string) => {
    if (next === AUTO_DEFAULT_MODEL) {
      runSettingsMutation(() => setDefaultModel(null), {
        onError: _reportDefaultModelError,
      });
      return;
    }
    const separator = next.indexOf(":");
    runSettingsMutation(
      () =>
        setDefaultModel({
          provider: next.slice(0, separator),
          id: next.slice(separator + 1),
        }),
      { onError: _reportDefaultModelError }
    );
  };

  function _reportDefaultModelError(error: unknown): void {
    toast.error("Failed to update default model", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="w-64" aria-label="Default model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO_DEFAULT_MODEL}>Automatic</SelectItem>
        {groups.length > 0 ? <SelectSeparator /> : null}
        {groups.map((group) => (
          <SelectGroup key={group.id}>
            <SelectLabel>{group.name}</SelectLabel>
            {group.models.map((model) => (
              <SelectItem
                key={`${model.provider}:${model.id}`}
                value={`${model.provider}:${model.id}`}
              >
                <ModelAvatar
                  id={model.id}
                  name={model.name}
                  icon={model.icon}
                  size={16}
                />
                <span className="font-mono">{model.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Opt out of anonymous, behaviour-only product analytics. The switch reflects
 * the user's stored preference; toggling it persists immediately via RPC. When
 * telemetry is force-disabled (no key, or `LLM_SPACE_ANALYTICS_DISABLED`), the
 * switch renders off and disabled and the description says nothing is sent,
 * instead of claiming data is being shared. See `shared/analytics.ts` for
 * exactly what is (and isn't) collected.
 */
function AnalyticsRow({
  status,
  onEnabledChange,
}: {
  status: AnalyticsStatus;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <SettingsRow
      label={
        <span className="flex flex-col gap-0.5">
          Share anonymous usage analytics
          <span className="text-muted-foreground text-xs">
            {status.available
              ? "Helps improve the app. Only anonymous actions are sent - never your prompts, messages, or API keys."
              : "Telemetry is turned off in this build or environment. Nothing is sent."}
          </span>
        </span>
      }
    >
      <Switch
        checked={status.available && status.enabled}
        disabled={!status.available}
        onCheckedChange={onEnabledChange}
        aria-label="Share anonymous usage analytics"
      />
    </SettingsRow>
  );
}

export function GeneralPage() {
  const { theme, setTheme } = useTheme();
  const { executeCommand } = useCommands();
  const { fidelity, setFidelity } = useRenderingFidelity();
  const { controller: analyticsController, state: analytics } = useController(
    ANALYTICS_SETTINGS_CONTROLLER
  );
  const { controller: updateModeController, state: updateMode } = useController(
    UPDATE_MODE_SETTINGS_CONTROLLER
  );
  const {
    primaryColor,
    resetPrimaryColor,
    resetPrimaryColorVersion,
    setPrimaryColor,
  } = usePrimaryColor();
  const showResetPrimaryColor = primaryColor !== DEFAULT_PRIMARY;
  return (
    <SettingsPage
      title="General"
      description="Customize appearance, defaults, privacy, and updates."
      className="overflow-y-auto"
    >
      <div className="flex flex-col gap-7 pb-2">
        <SettingsSection title="Appearance">
          <SettingsRow
            label={
              <RowLabel
                title="Language"
                hint="English only for now — more languages are coming."
              />
            }
          >
            <Select defaultValue="en-US" disabled>
              <SelectTrigger className="w-32" aria-label="Language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en-US">English (US)</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label={
              <RowLabel
                title="Theme"
                hint="Match your system setting, or force light or dark."
              />
            }
          >
            <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              <SelectTrigger className="w-32" aria-label="Theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label={
              <RowLabel
                title="Primary color"
                hint="The accent color for buttons, links, and highlights."
              />
            }
          >
            <div className="flex items-center gap-2">
              {showResetPrimaryColor ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={resetPrimaryColor}
                >
                  Reset
                </Button>
              ) : null}
              <PrimaryColorPicker
                key={resetPrimaryColorVersion}
                value={primaryColor}
                onChange={setPrimaryColor}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            label={
              <RowLabel
                title="Rendering"
                hint="Full renders messages with full editors. Fast shows them as plain text for smoother scrolling on large threads."
              />
            }
          >
            <Select
              value={fidelity}
              onValueChange={(v) => setFidelity(v as RenderingFidelity)}
            >
              <SelectTrigger className="w-32" aria-label="Rendering fidelity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rich">Full</SelectItem>
                <SelectItem value="lite">Fast</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Defaults">
          <SettingsRow
            label={
              <RowLabel
                title="Default model"
                hint="Used for new threads, and when a thread's model is no longer available."
              />
            }
          >
            <DefaultModelSelect />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Data & privacy">
          <AnalyticsRow
            status={analytics.settings}
            onEnabledChange={(enabled) =>
              void analyticsController.commit({
                ...analytics.settings,
                enabled,
              })
            }
          />
        </SettingsSection>

        <SettingsSection title="Updates">
          <SettingsRow
            label={
              <RowLabel
                title="Software updates"
                hint="Automatic downloads updates in the background and prompts you to restart."
              />
            }
          >
            <div className="flex items-center gap-2">
              <Select
                value={updateMode.settings}
                onValueChange={(value) =>
                  void updateModeController.commit(value as UpdateMode)
                }
              >
                <SelectTrigger className="w-40" aria-label="Software updates">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Check manually</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="lg"
                onClick={() =>
                  executeCommand({ type: "updates.check", args: {} })
                }
              >
                Check now
              </Button>
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    </SettingsPage>
  );
}
