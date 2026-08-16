"use client";

import {
  isSupportedProxyUrl,
  type SystemProxyDetection,
} from "@llm-space/core";
import { Input } from "@llm-space/ui/ui/input";
import { Separator } from "@llm-space/ui/ui/separator";

import { useController } from "@/app/di/react";
import { NETWORK_SETTINGS_CONTROLLER } from "@/app/di/settings-module";

import { SettingsPage } from "./settings-page";
import { SettingsToggleRow } from "./settings-toggle-row";

/** A titled proxy URL field with an inline "unsupported" warning. */
function ProxyField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const invalid = !isSupportedProxyUrl(value);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {invalid ? (
        <span className="text-destructive text-xs">
          Only <code>http://</code> and <code>https://</code> proxies are
          supported.
        </span>
      ) : null}
    </div>
  );
}

/** Strip the scheme from a proxy URL for a compact "host:port" display. */
function _hostPort(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url.replace(/^\w+:\/\//, "");
  }
}

/** The muted "Detected: …" line under the system-proxy toggle. */
function DetectedProxy({
  detection,
}: {
  detection: SystemProxyDetection | null;
}) {
  if (!detection) {
    return null;
  }
  if (detection.socksOnly) {
    return (
      <span className="text-destructive text-xs">
        A SOCKS proxy is set in System Settings, but SOCKS is not supported.
      </span>
    );
  }
  const hostPort = _hostPort(detection.httpProxy ?? detection.httpsProxy);
  if (!hostPort) {
    return (
      <span className="text-muted-foreground text-xs">
        No system proxy detected.
      </span>
    );
  }
  return (
    <span className="text-muted-foreground text-xs">
      Detected: <span className="font-mono">{hostPort}</span> (System Settings)
    </span>
  );
}

export function NetworkPage() {
  const { controller, state: snapshot } = useController(
    NETWORK_SETTINGS_CONTROLLER
  );
  const settings = snapshot.settings;

  return (
    <SettingsPage
      title="Network"
      description="Configure proxy settings for model requests and local network calls."
      className="overflow-y-auto"
    >
      <div className="flex flex-col gap-6 pb-2">
        <SettingsToggleRow
          title="Enable proxy"
          hint="Connect through a proxy for model requests and other network calls."
          checked={settings.enabled}
          onCheckedChange={(next) =>
            void controller.commit({ ...settings, enabled: next })
          }
        />

        {settings.enabled ? (
          <>
            <Separator />

            <div className="flex flex-col gap-2">
              <SettingsToggleRow
                title="Use system proxy"
                checked={settings.useSystemProxy}
                onCheckedChange={(next) =>
                  void controller.commit({
                    ...settings,
                    useSystemProxy: next,
                  })
                }
              />
              <DetectedProxy detection={snapshot.context} />
            </div>

            {settings.useSystemProxy ? null : (
              <>
                <ProxyField
                  label="HTTP Proxy"
                  value={settings.httpProxy}
                  placeholder="http://127.0.0.1:7890"
                  onChange={(value) =>
                    controller.update({ ...settings, httpProxy: value })
                  }
                  onBlur={() => void controller.save()}
                />

                <ProxyField
                  label="HTTPS Proxy"
                  value={settings.httpsProxy}
                  placeholder="http://127.0.0.1:7890"
                  onChange={(value) =>
                    controller.update({ ...settings, httpsProxy: value })
                  }
                  onBlur={() => void controller.save()}
                />

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Bypass list</span>
                  <Input
                    value={settings.noProxy}
                    placeholder="localhost, 127.0.0.1, .local"
                    aria-label="Bypass list"
                    onChange={(event) =>
                      controller.update({
                        ...settings,
                        noProxy: event.target.value,
                      })
                    }
                    onBlur={() => void controller.save()}
                  />
                  <span className="text-muted-foreground text-xs">
                    Comma-separated hosts that bypass the proxy.
                  </span>
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </SettingsPage>
  );
}
