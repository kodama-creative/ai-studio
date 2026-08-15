"use client";

import { cn } from "@llm-space/ui/lib/utils";
import { Button } from "@llm-space/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@llm-space/ui/ui/empty";
import {
  ArrowUpRightIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, type MouseEvent } from "react";

import { useCommands } from "@/commands";

interface WelcomeProps {
  className?: string;
  onNewStarter?: () => void;
  onNewPlayground?: () => void;
  onModels?: () => void;
}

export function Welcome({
  className,
  onNewStarter,
  onNewPlayground,
  onModels,
}: WelcomeProps) {
  const { executeCommand } = useCommands();

  const handleHeaderDoubleClick = useCallback(() => {
    executeCommand({ type: "window.toggleMaximized", args: {} });
  }, [executeCommand]);

  const handleLearnMore = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      executeCommand({ type: "shell.openDocument", args: {} });
    },
    [executeCommand]
  );

  return (
    <div
      className={cn(
        "bg-tabs relative flex size-full items-center justify-center",
        className
      )}
    >
      <div
        className="electrobun-webkit-app-region-drag absolute top-0 right-0 left-0 h-11.5"
        onDoubleClick={handleHeaderDoubleClick}
      ></div>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SparklesIcon className="size-8" />
          </EmptyMedia>
          <EmptyTitle>Welcome to LLM Space 4</EmptyTitle>
          <EmptyDescription>
            Start from an example, create a blank Playground, or open an Agent
            Project.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button onClick={onNewStarter}>
            <SparklesIcon />
            Start from examples
          </Button>
          <Button variant="outline" onClick={onNewPlayground}>
            <PlusIcon />
            Blank Playground
          </Button>
          <Button variant="outline" onClick={onModels}>
            <SettingsIcon />
            Configure models
          </Button>
        </EmptyContent>
        <Button
          variant="link"
          asChild
          className="text-muted-foreground"
          size="sm"
        >
          <a href="#" onClick={handleLearnMore}>
            Learn more <ArrowUpRightIcon />
          </a>
        </Button>
      </Empty>
    </div>
  );
}
