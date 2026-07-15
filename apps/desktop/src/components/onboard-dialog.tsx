"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  SettingsIcon,
  XIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ModelProviderGroup } from "@llm-space/core";

import { useCommands } from "@/commands";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import {
  useAddProvider,
  useFetchBuiltinProviders,
  useModels
} from "./model-provider";
import { ProviderAvatar } from "./thread-playground/provider-avatar";
import { Button } from "./ui/button";
import { RainbowButton } from "./ui/rainbow-button";
import { Spinner } from "./ui/spinner";

/**
 * First-run onboarding dialog. Shown automatically when no models are configured
 * yet, and reachable any time via the "Onboard..." command (Help menu).
 */
export function OnboardDialog({
  open,
  onOpenChange
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const models = useModels();
  const { executeCommand } = useCommands();
  const fetchBuiltinProviders = useFetchBuiltinProviders();
  const addProvider = useAddProvider();
  const [builtinProviders, setBuiltinProviders] = useState<
    ModelProviderGroup[] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addingProviderId, setAddingProviderId] = useState<string | null>(null);
  const [addedProviderName, setAddedProviderName] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!open || models.length > 0) {
      return;
    }

    let cancelled = false;
    // Clear the previous request's error when a new external fetch begins.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    void fetchBuiltinProviders()
      .then(providers => {
        if (!cancelled) {
          setBuiltinProviders(providers);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setLoadError(PROVIDER_DISCOVERY_ERROR_MESSAGE);
        setBuiltinProviders([]);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchBuiltinProviders, models.length, open]);

  const detectedProviders = useMemo(() => {
    return (builtinProviders ?? [])
      .filter(provider => provider.apiKeyDetected)
      .sort(_sortProviderForOnboarding);
  }, [builtinProviders]);

  const recommendedProviders = useMemo(() => {
    return (builtinProviders ?? [])
      .filter(provider =>
        ONBOARDING_RECOMMENDED_PROVIDER_IDS.has(provider.id))
      .sort(_sortProviderForOnboarding)
      .slice(0, 3);
  }, [builtinProviders]);

  const handleConfigureModels = useCallback(() => {
    track({
      event: "onboarding_choice",
      properties: { choice: "configure_models" }
    });
    onOpenChange(false);
    executeCommand({ type: "openSettings", args: { tab: "models" } });
  }, [executeCommand, onOpenChange]);
  const handleLearnMore = useCallback(() => {
    track({ event: "onboarding_choice", properties: { choice: "learn_more" } });
    executeCommand({ type: "openDocument", args: {} });
  }, [executeCommand]);
  const handleOpenAnalyticsSettings = useCallback(() => {
    track({
      event: "onboarding_choice",
      properties: { choice: "analytics_settings" }
    });
    onOpenChange(false);
    executeCommand({ type: "openSettings", args: { tab: "general" } });
  }, [executeCommand, onOpenChange]);

  const handleAddProvider = useCallback(
    async (provider: ModelProviderGroup) => {
      setAddingProviderId(provider.id);
      try {
        await addProvider(provider.id);
        setAddedProviderName(provider.name);
        toast.success(`${provider.name} is ready`);
      } catch {
        toast.error("Could not add provider", {
          description: ADD_PROVIDER_ERROR_MESSAGE
        });
      } finally {
        setAddingProviderId(null);
      }
    },
    [addProvider]
  );

  const handleReady = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const readyProviderName =
    addedProviderName ?? models[0]?.name ?? models[0]?.id ?? null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="w-full max-w-[820px]! overflow-hidden p-0"
        onInteractOutside={event => {
          event.preventDefault();
        }}
        onPointerDownOutside={event => {
          event.preventDefault();
        }}
        showCloseButton={false}
      >
        <div className="relative">
          <img
            alt="Onboard"
            className="w-full rounded-lg"
            src="/images/onboard.png"
          />
          <DialogClose asChild>
            <Button
              aria-label="Close onboarding"
              className="bg-muted/75 hover:bg-muted/85! text-foreground/80 absolute top-2 right-2 rounded-full"
              size="icon-sm"
              variant="ghost"
            >
              <XIcon className="size-3" />
            </Button>
          </DialogClose>
          <div className="absolute right-6 bottom-6 left-6 flex flex-col gap-3 md:right-8 md:bottom-8 md:left-12 md:flex-row md:items-end md:justify-between">
            <div className="flex shrink-0 flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-4">
                {models.length === 0
                  ? (
                    <Button
                      className="border-ring/75 h-11 rounded-2xl border bg-white/10! px-6 backdrop-blur-xs"
                      onClick={handleConfigureModels}
                      size="lg"
                      variant="outline"
                    >
                      <SettingsIcon className="size-3" />
                      Configure models
                    </Button>
                  )
                  : (
                    <DialogClose asChild>
                      <RainbowButton
                        className="dark:bg-[red]!"
                        size="lg"
                        variant="outline"
                      >
                        Get started
                        <ArrowRightIcon className="size-3.5" />
                      </RainbowButton>
                    </DialogClose>
                  )}
                <Button
                  className="h-11 rounded-2xl border border-white/20 bg-white/10! px-8 text-white backdrop-blur-xs"
                  onClick={handleLearnMore}
                  size="lg"
                  variant="outline"
                >
                  Learn more
                </Button>
              </div>
              <div className="text-xs text-white/65">
                We collect anonymous usage data to improve the app.{" "}
                <button
                  className="underline underline-offset-2 transition-colors hover:text-white/90"
                  onClick={handleOpenAnalyticsSettings}
                  type="button"
                >
                  Manage in settings
                </button>
              </div>
            </div>
            <_OnboardSetupPanel
              addingProviderId={addingProviderId}
              className="w-full md:w-[22rem] md:shrink-0"
              configured={models.length > 0}
              detectedProviders={detectedProviders}
              loadError={loadError}
              loading={builtinProviders === null && models.length === 0}
              onAddProvider={providerId => { void handleAddProvider(providerId); }}
              onConfigureModels={handleConfigureModels}
              onReady={handleReady}
              readyProviderName={readyProviderName}
              recommendedProviders={recommendedProviders}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ONBOARDING_PROVIDER_ORDER = [
  "openai-codex",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "ark"
];

const ONBOARDING_RECOMMENDED_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "google"
]);

const PROVIDER_DISCOVERY_ERROR_MESSAGE =
  "Provider check did not finish. Open model settings to continue.";

const ADD_PROVIDER_ERROR_MESSAGE = "Open model settings and try again.";

/** Sort discovered providers so the lowest-friction local options appear first. */
function _sortProviderForOnboarding(
  a: ModelProviderGroup,
  b: ModelProviderGroup
): number {
  const rankA = ONBOARDING_PROVIDER_ORDER.indexOf(a.id);
  const rankB = ONBOARDING_PROVIDER_ORDER.indexOf(b.id);
  const normalizedA = rankA === -1 ? ONBOARDING_PROVIDER_ORDER.length : rankA;
  const normalizedB = rankB === -1 ? ONBOARDING_PROVIDER_ORDER.length : rankB;
  return normalizedA - normalizedB || a.name.localeCompare(b.name);
}

const _OnboardSetupPanel = function OnboardSetupPanel({
  className,
  configured,
  readyProviderName,
  detectedProviders,
  recommendedProviders,
  loading,
  loadError,
  addingProviderId,
  onAddProvider,
  onConfigureModels,
  onReady
}: {
  readonly addingProviderId: string | null;
  readonly className?: string;
  readonly configured: boolean;
  readonly detectedProviders: ModelProviderGroup[];
  readonly loadError: string | null;
  readonly loading: boolean;
  readonly onAddProvider: (provider: ModelProviderGroup) => void;
  readonly onConfigureModels: () => void;
  readonly onReady: () => void;
  readonly readyProviderName: string | null;
  readonly recommendedProviders: ModelProviderGroup[];
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-black/45 p-3.5 text-white shadow-2xl backdrop-blur-md",
        className
      )}
    >
      {configured
        ? (
          <_ReadySetupState onReady={onReady} providerName={readyProviderName} />
        )
        : loading
          ? (
            <_LoadingSetupState />
          )
          : loadError
            ? (
              <_ManualSetupState
                description={loadError}
                onConfigureModels={onConfigureModels}
                recommendedProviders={[]}
                title="Provider check failed"
              />
            )
            : detectedProviders.length > 0
              ? (
                <_DetectedSetupState
                  addingProviderId={addingProviderId}
                  onAddProvider={onAddProvider}
                  providers={detectedProviders.slice(0, 3)}
                />
              )
              : (
                <_ManualSetupState
                  description="Add a provider in settings to choose a model."
                  onConfigureModels={onConfigureModels}
                  recommendedProviders={recommendedProviders}
                  title="No local provider found"
                />
              )}
    </div>
  );
};

const _LoadingSetupState = function LoadingSetupState() {
  return (
    <div className="flex items-center gap-3">
      <Spinner className="size-4 text-white/80" />
      <div className="min-w-0">
        <div className="text-sm font-medium">Checking local providers</div>
        <div className="text-xs text-white/65">
          Looking for credentials already available on this computer.
        </div>
      </div>
    </div>
  );
};

const _ReadySetupState = function ReadySetupState({
  providerName,
  onReady
}: {
  readonly onReady?: () => void;
  readonly providerName: string | null;
}) {
  return (
    <div className="flex cursor-pointer items-start gap-3" onClick={onReady}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/18 text-emerald-200">
        <CheckIcon className="size-4" />
      </div>
      <div className="min-w-0 grow">
        <div className="text-sm font-medium">Ready to run</div>
        <div className="text-xs text-white/65">
          {providerName
            ? `${providerName} is configured for this workspace.`
            : "A provider is configured for this workspace."}
        </div>
      </div>
    </div>
  );
};

const _DetectedSetupState = function DetectedSetupState({
  providers,
  addingProviderId,
  onAddProvider
}: {
  readonly addingProviderId: string | null;
  readonly onAddProvider: (provider: ModelProviderGroup) => void;
  readonly providers: ModelProviderGroup[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-medium">
          {providers.length === 1 ? "Provider detected" : "Providers detected"}
        </div>
        <div className="text-xs text-white/65">
          {providers.length === 1
            ? "Add a detected provider from the list to get started."
            : "Add detected providers from the list to get started."}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {providers.map(provider => {
          const adding = addingProviderId === provider.id;
          return (
            <button
              aria-label={`Add detected provider ${provider.name}`}
              className="flex w-full items-center gap-3 rounded-xl border border-white/15 bg-white/10 p-2.5 text-left transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
              disabled={Boolean(addingProviderId)}
              key={provider.id}
              onClick={() => { onAddProvider(provider); }}
              type="button"
            >
              <ProviderAvatar
                className="shrink-0"
                icon={provider.icon}
                id={provider.id}
                name={provider.name}
              />
              <span className="min-w-0 grow">
                <span className="block truncate text-sm font-medium">
                  {provider.name}
                </span>
                <span className="block text-xs text-white/60">
                  Detected locally
                </span>
              </span>
              {adding
                ? (
                  <Spinner className="size-3.5 shrink-0 text-white/80" />
                )
                : (
                  <ArrowRightIcon className="size-3.5 shrink-0 text-white/70" />
                )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const _ManualSetupState = function ManualSetupState({
  title,
  description,
  recommendedProviders,
  onConfigureModels
}: {
  readonly description: string;
  readonly onConfigureModels: () => void;
  readonly recommendedProviders: ModelProviderGroup[];
  readonly title: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/75">
          <CircleAlertIcon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-white/65">{description}</div>
        </div>
      </div>
      {recommendedProviders.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-white/80">
            Recommended setup
          </div>
          {recommendedProviders.map(provider => (
            <button
              aria-label={`Open model settings to configure ${provider.name}`}
              className="flex w-full items-center gap-3 rounded-xl border border-white/15 bg-white/10 p-2.5 text-left transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              key={provider.id}
              onClick={onConfigureModels}
              type="button"
            >
              <ProviderAvatar
                className="shrink-0"
                icon={provider.icon}
                id={provider.id}
                name={provider.name}
              />
              <span className="min-w-0 grow">
                <span className="block truncate text-sm font-medium">
                  {provider.name}
                </span>
                <span className="block text-xs text-white/60">
                  Set up in model settings
                </span>
              </span>
              <ArrowRightIcon className="size-3.5 shrink-0 text-white/70" />
            </button>
          ))}
        </div>
      )}
      <Button
        className="h-9 w-full rounded-xl border border-white/20 bg-white/10! backdrop-blur-xs"
        onClick={onConfigureModels}
        variant="outline"
      >
        <SettingsIcon className="size-3.5" />
        Open model settings
      </Button>
    </div>
  );
};
