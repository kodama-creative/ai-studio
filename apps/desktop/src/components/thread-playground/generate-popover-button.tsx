"use client";

import { SparklesIcon, WandSparkles } from "lucide-react";
import { type KeyboardEvent, memo, useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import { Tooltip } from "../tooltip";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";

interface GeneratePopoverButtonProps {
  readonly className?: string;
  readonly iconOnly?: boolean;
  readonly placeholder?: string;
  readonly onGenerate: (prompt: string) => void;
}

function _GeneratePopoverButton({
  className,
  iconOnly = false,
  placeholder = "Describe what your function does (or paste your code), and we'll generate a definition.",
  onGenerate
}: GeneratePopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");

  const handleGenerate = useCallback(() => {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      return;
    }

    onGenerate(trimmedPrompt);
    setOpen(false);
    setPrompt("");
  }, [onGenerate, prompt]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  const button = (
    <Button
      aria-expanded={open}
      aria-label="Generate"
      className={className}
      size={iconOnly ? "icon" : "sm"}
      variant="ghost"
    >
      <WandSparkles data-icon={iconOnly ? undefined : "inline-start"} />
      {iconOnly ? null : "Generate"}
    </Button>
  );

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {iconOnly
        ? (
          <Tooltip content="Generate">
            <PopoverTrigger asChild>{button}</PopoverTrigger>
          </Tooltip>
        )
        : (
          <PopoverTrigger asChild>{button}</PopoverTrigger>
        )}
      <PopoverContent
        align="center"
        avoidCollisions={false}
        className={cn(
          "bg-background/85 h-50 w-120 gap-0 rounded-xl p-2 shadow-2xl backdrop-blur-xs"
        )}
        sideOffset={12}
      >
        <Textarea
          autoFocus
          className="min-h-0 flex-1 border-0! bg-transparent! font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0 md:text-base"
          onChange={event => { setPrompt(event.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          value={prompt}
        />
        <div className="flex justify-end">
          <Button
            className="bg-foreground/80 text-background hover:bg-foreground rounded-lg py-4 text-sm"
            onClick={handleGenerate}
            variant="default"
          >
            <SparklesIcon />
            Generate
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const GeneratePopoverButton = memo(_GeneratePopoverButton);
