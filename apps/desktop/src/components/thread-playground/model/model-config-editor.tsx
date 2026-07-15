"use client";

import { useModel, useResolveModelConfig } from "@/components/model-provider";
import { cn } from "@/lib/utils";
import { ModelParamsPopover } from "./model-params-popover";
import { ModelSelector } from "./model-selector";
import { useThreadStore } from "../stores";

export function ModelConfigEditor({
  className,
  readonly,
  preserveSavedModel = false
}: {
  readonly className?: string;
  readonly preserveSavedModel?: boolean;
  readonly readonly?: boolean;
}) {
  // A thread may have no saved model, or a stale one whose provider was removed;
  // resolve it for display (own → default → first available). `null` when there
  // are no models at all.
  const savedModel = useThreadStore(s => s.thread.model);
  const resolvedFallbackModel = useResolveModelConfig(savedModel);
  const model = preserveSavedModel ? savedModel : resolvedFallbackModel;
  const resolvedModel = useModel({
    id: model?.id ?? "",
    provider: model?.provider ?? ""
  });

  const paramSummary: Array<{ label: string; value: number | string; }> = [];
  if (model?.params?.temperature !== undefined) {
    paramSummary.push({
      label: "temperature",
      value: model.params.temperature
    });
  }
  if (model?.params?.maxTokens !== undefined) {
    paramSummary.push({ label: "max_tokens", value: model.params.maxTokens });
  }
  if (
    (preserveSavedModel || resolvedModel?.reasoning)
    && model?.params?.reasoning !== undefined
  ) {
    paramSummary.push({ label: "reasoning", value: model.params.reasoning });
  }

  return (
    <div className={cn("group flex w-full", className)}>
      <div className="flex min-w-0 grow flex-col gap-2">
        <div className="flex cursor-default items-center text-sm">
          <ModelSelector readonly={readonly} value={model ?? null} />
        </div>
        {paramSummary.length > 0
          ? (
            <div className="text-muted-foreground pl-2 text-xs">
              {paramSummary.map((item, index) => (
                <span className="font-mono" key={item.label}>
                  {index > 0 ? ", " : null}
                  {item.label}: <span>{item.value}</span>
                </span>
              ))}
            </div>
          )
          : null}
      </div>
      <ModelParamsPopover
        maxTokens={resolvedModel?.maxTokens}
        readonly={readonly}
      />
    </div>
  );
}
