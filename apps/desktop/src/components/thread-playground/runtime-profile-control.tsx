import {
  ChevronDownIcon,
  LaptopIcon,
  ServerIcon,
  ShieldIcon
} from "lucide-react";
import { memo } from "react";

import type { ThreadRuntimeProfile } from "@llm-space/core";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";

import type { ExternalAgentProjectRuntimeStatus } from "@/shared/external-agent-project";

const STATUS_LABELS: Record<
  ExternalAgentProjectRuntimeStatus["state"],
  string
> = {
  preparing: "Preparing",
  ready: "Ready",
  running: "Running",
  reconnecting: "Reconnecting",
  stale: "Stale",
  unavailable: "Unavailable"
};

const _RuntimeProfileControl = function RuntimeProfileControl({
  disabled,
  onSelect,
  profile,
  sandboxRequired,
  sandboxStatus,
  status
}: {
  readonly disabled?: boolean;
  readonly onSelect: (type: ThreadRuntimeProfile["type"]) => void;
  readonly profile: ThreadRuntimeProfile;
  readonly sandboxRequired?: boolean;
  readonly sandboxStatus: ExternalAgentProjectRuntimeStatus;
  readonly status: ExternalAgentProjectRuntimeStatus;
}) {
  const localServer = profile.type === "localServer";
  const sandbox = profile.type === "desktopSandbox";
  const profileLabel = localServer
    ? "Local Server"
    : sandbox ? "Desktop Sandbox" : "Desktop Direct";
  const StatusIcon = localServer ? ServerIcon : sandbox ? ShieldIcon : LaptopIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Runtime Profile: ${profileLabel}, ${STATUS_LABELS[status.state]}`}
          className="h-5 max-w-48 gap-1 px-1.5 text-[10px]"
          disabled={disabled}
          size="sm"
          variant="outline"
        >
          <StatusIcon className="size-3 shrink-0" />
          <span className="hidden truncate min-[1024px]:inline">
            {profileLabel}
          </span>
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status.state === "ready" && "bg-emerald-400",
              (status.state === "preparing"
                || status.state === "running"
                || status.state === "reconnecting")
              && "bg-amber-400",
              (status.state === "stale" || status.state === "unavailable")
              && "bg-destructive"
            )}
          />
          <span className="truncate">{STATUS_LABELS[status.state]}</span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Runtime Profile</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <_ProfileItem
          description="Editable Desktop transcript with manual, auto-once, and ReAct debugging."
          disabled={sandboxRequired}
          icon={<LaptopIcon className="size-4" />}
          label="Desktop Direct"
          onSelect={() => { onSelect("desktopDirect"); }}
          selected={!localServer && !sandbox}
        />
        <_ProfileItem
          description="Isolated Session workspace with controlled files and no network or Host secrets."
          disabled={sandboxStatus.state === "unavailable"}
          icon={<ShieldIcon className="size-4" />}
          label="Desktop Sandbox"
          onSelect={() => { onSelect("desktopSandbox"); }}
          selected={sandbox}
          status={sandboxStatus.state === "unavailable" ? "Unavailable" : undefined}
        />
        <_ProfileItem
          description="Protected loopback Server with Server-owned transcript and Run identity."
          icon={<ServerIcon className="size-4" />}
          label="Local Server"
          onSelect={() => { onSelect("localServer"); }}
          selected={localServer}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const RuntimeProfileControl = memo(_RuntimeProfileControl);

function _ProfileItem({
  description,
  disabled,
  icon,
  label,
  onSelect,
  selected,
  status
}: {
  readonly description: string;
  readonly disabled?: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onSelect?: () => void;
  readonly selected?: boolean;
  readonly status?: string;
}) {
  return (
    <DropdownMenuItem
      className="items-start gap-2 py-2"
      disabled={disabled}
      onSelect={onSelect}
    >
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 grow">
        <span className="flex items-center gap-2 text-xs font-medium">
          {label}
          {selected ? <span className="text-primary">Selected</span> : null}
          {status
            ? <span className="text-destructive ml-auto">{status}</span>
            : null}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-[10px] leading-relaxed whitespace-normal">
          {description}
        </span>
      </span>
    </DropdownMenuItem>
  );
}
