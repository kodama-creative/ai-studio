"use client";

import { useState } from "react";

import { useCommands } from "@/commands";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useExperimental } from "@/components/experimental-provider";
import { Switch } from "@/components/ui/switch";
import { SettingsPage } from "./settings-page";

export function ExperimentalPage() {
  const { tracingEnabled, setTracingEnabled, reactScanEnabled, setReactScanEnabled } =
    useExperimental();
  const { executeCommand } = useCommands();
  const [reloadPromptOpen, setReloadPromptOpen] = useState(false);

  const handleReactScanChange = (next: boolean) => {
    setReactScanEnabled(next);
    // react-scan patches the reconciler at startup, so the change only lands
    // after a reload — offer to do it now.
    setReloadPromptOpen(true);
  };

  return (
    <SettingsPage title="Experimental">
      <div className="flex h-14 items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5 text-sm">
          Tracing
          <span className="text-muted-foreground text-xs">
            Enable to connect Langfuse or create a manual project for JSON
            exports.
          </span>
        </span>
        <Switch
          aria-label="Tracing"
          checked={tracingEnabled}
          onCheckedChange={setTracingEnabled}
        />
      </div>
      {import.meta.env.DEV
        ? (
          <div className="flex h-14 items-center justify-between gap-4">
            <span className="flex flex-col gap-0.5 text-sm">
              React Scan
              <span className="text-muted-foreground text-xs">
                Overlay that highlights component re-renders. Takes effect after a
                reload. Dev builds only.
              </span>
            </span>
            <Switch
              aria-label="React Scan"
              checked={reactScanEnabled}
              onCheckedChange={handleReactScanChange}
            />
          </div>
        )
        : null}
      <ConfirmDialog
        cancelLabel="Later"
        confirmLabel="Reload"
        confirmVariant="default"
        description={`React Scan will be ${
          reactScanEnabled ? "enabled" : "disabled"
        } after the app reloads. Reload now?`}
        dimBackground={false}
        onConfirm={() => {
          setReloadPromptOpen(false);
          executeCommand({ type: "reload", args: {} });
        }}
        onOpenChange={setReloadPromptOpen}
        open={reloadPromptOpen}
        title="Reload to apply?"
      />
    </SettingsPage>
  );
}
