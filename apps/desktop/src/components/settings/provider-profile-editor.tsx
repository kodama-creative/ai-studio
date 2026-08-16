"use client";

import type {
  ModelProviderGroup,
  ProviderProfile,
} from "@llm-space/core";
import { useUpdateProviderProfile } from "@llm-space/ui/components/model-provider";
import { Tooltip } from "@llm-space/ui/components/tooltip";
import { Button } from "@llm-space/ui/ui/button";
import { Input } from "@llm-space/ui/ui/input";
import { Switch } from "@llm-space/ui/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import {
  ProviderProfileController,
  type ProviderProfileField,
  type ProviderProfileTarget,
} from "@/app/settings/provider-profile-controller";

import { ApiKeyField } from "./api-key-field";

/**
 * Base-URL guidance for the Anthropic Messages API. Its SDK appends `/v1/...`
 * itself, unlike OpenAI-style SDKs that expect `/v1` in the configured URL.
 */
const ANTHROPIC_BASE_URL_HINT =
  "The Anthropic SDK adds /v1 to the request path itself, so enter the URL without a /v1 suffix.";

export function ProviderProfileEditor({
  provider,
  profile,
  isBuiltin,
  usesAnthropicApi,
}: {
  provider: ModelProviderGroup;
  profile: ProviderProfile;
  isBuiltin: boolean;
  usesAnthropicApi: boolean;
}) {
  const updateProfile = useUpdateProviderProfile();
  const target = useMemo<ProviderProfileTarget>(
    () => ({
      providerId: provider.id,
      profile: {
        id: profile.id,
        name: profile.name,
        ...(profile.apiKey === undefined ? {} : { apiKey: profile.apiKey }),
        ...(profile.baseUrl === undefined
          ? {}
          : { baseUrl: profile.baseUrl }),
        ...(profile.headers === undefined
          ? {}
          : { headers: profile.headers }),
      },
    }),
    [
      profile.apiKey,
      profile.baseUrl,
      profile.headers,
      profile.id,
      profile.name,
      provider.id,
    ]
  );
  const initialTarget = useRef(target).current;
  const controller = useMemo(
    () =>
      new ProviderProfileController(initialTarget, {
        updateProfile,
        saveFailed: (field, error) => {
          toast.error(_failureTitle(field), {
            description:
              error instanceof Error ? error.message : "Please try again.",
          });
        },
      }),
    [initialTarget, updateProfile]
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  useLayoutEffect(() => {
    controller.sync(target);
  }, [controller, target]);
  useEffect(() => () => controller.close(), [controller]);

  const baseUrlPlaceholder = usesAnthropicApi
    ? "https://api.example.com"
    : "https://api.example.com/v1";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Profile name</span>
        <Input
          value={snapshot.name}
          placeholder="Profile name"
          aria-label={`${provider.name} profile name`}
          onChange={(event) => controller.draft("name", event.target.value)}
          onBlur={() => controller.commit("name")}
        />
      </div>

      {provider.id !== "openai-codex" ? (
        <ApiKeyField
          label="API key"
          getKeyUrl={provider.websiteLink}
          value={snapshot.apiKey}
          placeholder={`Input API Key for ${provider.name}.`}
          aria-label={`${profile.name} API key`}
          onChange={(event) => controller.draft("apiKey", event.target.value)}
          onBlur={() => controller.commit("apiKey")}
          description={
            <div className="text-muted-foreground pl-5 text-xs">
              <div className="list-item">
                {
                  'Use "${ENV_NAME}" to reference environment variables. e.g. "$OPENAI_API_KEY"'
                }
              </div>
              <div className="list-item">
                Leave it blank to use the official {provider.name} environment
                variable
              </div>
            </div>
          }
        />
      ) : null}

      {isBuiltin ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Custom base URL</span>
            <Switch
              aria-label={
                snapshot.baseUrlEnabled
                  ? `Disable custom base URL for ${profile.name}`
                  : `Enable custom base URL for ${profile.name}`
              }
              checked={snapshot.baseUrlEnabled}
              onCheckedChange={(enabled) =>
                controller.setBaseUrlEnabled(enabled)
              }
            />
          </div>
          {snapshot.baseUrlEnabled ? (
            <>
              <Input
                value={snapshot.baseUrl}
                placeholder={baseUrlPlaceholder}
                aria-label={`${profile.name} custom base URL`}
                onChange={(event) =>
                  controller.draft("baseUrl", event.target.value)
                }
                onBlur={() => controller.commit("baseUrl")}
              />
              <div className="text-muted-foreground text-xs">
                Leave empty to use the default endpoint.
                {usesAnthropicApi ? ` ${ANTHROPIC_BASE_URL_HINT}` : null}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Base URL</span>
          <Input
            required
            value={snapshot.baseUrl}
            placeholder={baseUrlPlaceholder}
            aria-label={`${profile.name} base URL`}
            onChange={(event) =>
              controller.draft("baseUrl", event.target.value)
            }
            onBlur={() => controller.commit("baseUrl")}
          />
          {usesAnthropicApi ? (
            <div className="text-muted-foreground text-xs">
              {ANTHROPIC_BASE_URL_HINT}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Custom headers</span>
        {snapshot.headers.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.key}
              placeholder="X-Header-Name"
              aria-label={`${provider.name} header ${index + 1} name`}
              onChange={(event) =>
                controller.editHeader(row.id, "key", event.target.value)
              }
              onBlur={() => controller.commitHeaders()}
            />
            <Input
              value={row.value}
              placeholder="Value"
              aria-label={`${provider.name} header ${index + 1} value`}
              onChange={(event) =>
                controller.editHeader(row.id, "value", event.target.value)
              }
              onBlur={() => controller.commitHeaders()}
            />
            <Tooltip content="Remove header">
              <button
                type="button"
                aria-label={`Remove header ${index + 1}`}
                onClick={() => controller.removeHeader(row.id)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors"
              >
                <Trash2 className="size-4" />
              </button>
            </Tooltip>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => controller.addHeader()}
        >
          <Plus /> Add header
        </Button>
        <div className="text-muted-foreground text-xs">
          Sent with every request made through this profile.
        </div>
      </div>
    </div>
  );
}

function _failureTitle(field: ProviderProfileField): string {
  switch (field) {
    case "name":
      return "Failed to rename connection profile";
    case "apiKey":
      return "Failed to update API key";
    case "baseUrl":
      return "Failed to update base URL";
    case "headers":
      return "Failed to update custom headers";
  }
}
