"use client";

import { InfoIcon, SettingsIcon, SlidersHorizontal } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { ReasoningLevel } from "@llm-space/core";

import { useCommands } from "@/commands";
import { useFirstAvailableModel } from "@/components/model-provider";
import { cn } from "@/lib/utils";
import { ModelCard } from "./model-card";
import { Tooltip } from "../../tooltip";
import { Button } from "../../ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from "../../ui/hover-card";
import { Input } from "../../ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "../../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../ui/select";
import { Slider } from "../../ui/slider";
import { Switch } from "../../ui/switch";
import { useThreadStore, useThreadStoreActions } from "../stores/thread-store";

const REASONING_LEVELS: Array<{ label: string; value: ReasoningLevel; }> = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" }
];

const DEFAULT_TEMPERATURE = 1;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_REASONING: ReasoningLevel = "medium";

function ParamField({
  className,
  label,
  enabled,
  readonly,
  onEnabledChange,
  children
}: {
  readonly className?: string;
  readonly enabled: boolean;
  readonly label: string;
  readonly readonly?: boolean;

  readonly children: ReactNode;
  readonly onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <div className={cn("border-t pt-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-sm", !enabled && "text-muted-foreground")}>
          {label}
        </span>
        <Switch
          aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
          checked={enabled}
          disabled={readonly}
          onCheckedChange={onEnabledChange}
          size="sm"
        />
      </div>
      {enabled ? children : null}
    </div>
  );
}

export function ModelParamsPopover({
  readonly,
  maxTokens: maxTokensFromProps
}: {
  readonly maxTokens?: number;
  readonly readonly?: boolean;
}) {
  // Fall back to the first available model when the thread has none saved yet;
  // `null` when there are no models to configure at all.
  const savedModel = useThreadStore(s => s.thread.model);
  const fallbackModel = useFirstAvailableModel();
  const model = savedModel ?? fallbackModel;
  const { updateModelParams } = useThreadStoreActions();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setPopoverOpen(open);
    },
    [setPopoverOpen]
  );

  const params = model?.params ?? {};
  const hasTemperature = params.temperature !== undefined;
  const hasReasoning = params.reasoning !== undefined;
  const hasMaxTokens = params.maxTokens !== undefined;

  const temperature = params.temperature ?? DEFAULT_TEMPERATURE;
  const reasoning = params.reasoning ?? DEFAULT_REASONING;
  const maxTokens = params.maxTokens;

  const [draftMaxTokens, setDraftMaxTokens] = useState(
    maxTokens !== undefined ? String(maxTokens) : ""
  );
  const isMaxTokensFocusedRef = useRef(false);

  useEffect(() => {
    if (!isMaxTokensFocusedRef.current) {
      setDraftMaxTokens(maxTokens !== undefined ? String(maxTokens) : "");
    }
  }, [maxTokens]);

  const commitMaxTokens = useCallback(() => {
    const committed = maxTokens !== undefined ? String(maxTokens) : "";
    if (draftMaxTokens !== committed) {
      updateModelParams({
        maxTokens: draftMaxTokens === "" ? undefined : Number(draftMaxTokens)
      });
    }
  }, [draftMaxTokens, maxTokens, updateModelParams]);

  const { executeCommand } = useCommands();
  const handleConfigModelSettings = useCallback(() => {
    setPopoverOpen(false);
    executeCommand({ type: "openSettings", args: { tab: "models" } });
  }, [setPopoverOpen, executeCommand]);

  return (
    <div
      className={cn(
        "flex shrink-0 gap-1",
        readonly && "invisible"
      )}
    >
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            aria-label="Show model details"
            disabled={!model}
            size="icon-xs"
            variant="ghost"
          >
            <InfoIcon className="size-4" />
          </Button>
        </HoverCardTrigger>
        <HoverCardContent>
          <ModelCard model={model} />
        </HoverCardContent>
      </HoverCard>
      <Popover onOpenChange={handleOpenChange}>
        <Tooltip content="Configure model settings">
          <PopoverTrigger asChild>
            <Button
              aria-expanded={popoverOpen}
              aria-label="Configure model parameters"
              disabled={Boolean(readonly) || !model}
              size="icon-xs"
              variant="ghost"
            >
              <SlidersHorizontal className="size-4" />
            </Button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent align="end" className="flex w-72 flex-col p-4">
          <PopoverHeader>
            <PopoverTitle className="flex items-center justify-between">
              <div>Model settings</div>
              <div>
                <Tooltip content="Configure model settings">
                  <Button
                    aria-label="Open model provider settings"
                    onClick={handleConfigModelSettings}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <SettingsIcon className="size-3.5" />
                  </Button>
                </Tooltip>
              </div>
            </PopoverTitle>
          </PopoverHeader>
          <ParamField
            enabled={hasTemperature}
            label="Temperature"
            onEnabledChange={enabled => {
              updateModelParams({
                temperature: enabled ? DEFAULT_TEMPERATURE : undefined
              });
            }}
            readonly={readonly}
          >
            <div className="space-y-2 pt-2">
              <div className="flex justify-end">
                <span className="text-muted-foreground font-mono tabular-nums">
                  {temperature}
                </span>
              </div>
              <Slider
                aria-label="Temperature"
                disabled={readonly}
                max={2}
                min={0}
                onValueChange={([value]) => {
                  if (value !== undefined) {
                    updateModelParams({ temperature: value });
                  }
                }}
                step={0.1}
                value={[temperature]}
              />
            </div>
          </ParamField>

          <ParamField
            enabled={hasMaxTokens}
            label="Max tokens"
            onEnabledChange={enabled => {
              updateModelParams({
                maxTokens: enabled ? DEFAULT_MAX_TOKENS : undefined
              });
            }}
            readonly={readonly}
          >
            <Input
              aria-label="Max tokens"
              className="mt-2 w-full font-mono"
              disabled={readonly}
              max={maxTokensFromProps}
              min={1}
              onBlur={() => {
                isMaxTokensFocusedRef.current = false;
                commitMaxTokens();
              }}
              onChange={event => {
                setDraftMaxTokens(event.target.value);
              }}
              onFocus={() => {
                isMaxTokensFocusedRef.current = true;
              }}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              type="number"
              value={draftMaxTokens}
            />
          </ParamField>

          <ParamField
            enabled={hasReasoning}
            label="Thinking effort"
            onEnabledChange={enabled => {
              updateModelParams({
                reasoning: enabled ? DEFAULT_REASONING : undefined
              });
            }}
            readonly={readonly}
          >
            <Select
              disabled={readonly}
              onValueChange={value => {
                updateModelParams({ reasoning: value as ReasoningLevel });
              }}
              value={reasoning}
            >
              <SelectTrigger
                aria-label="Thinking effort"
                className="mt-2 w-full"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="font-mono">
                {REASONING_LEVELS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ParamField>
        </PopoverContent>
      </Popover>
    </div>
  );
}
