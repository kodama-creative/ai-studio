"use client";

import {
  ArrowUpRightIcon,
  BotIcon,
  FolderOpenIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon
} from "lucide-react";
import { type MouseEvent, useCallback } from "react";

import { useCommands } from "@/commands";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "./ui/empty";

interface WelcomeProps {
  readonly className?: string;
  readonly onNewStarter?: () => void;
  readonly onNewFile?: () => void;
  readonly onModels?: () => void;
}

export function Welcome({
  className,
  onNewStarter,
  onNewFile,
  onModels
}: WelcomeProps) {
  const { executeCommand } = useCommands();

  const handleHeaderDoubleClick = useCallback(() => {
    void electrobun.rpc?.request.toggleMaximized({});
  }, []);

  const handleLearnMore = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      executeCommand({ type: "openDocument", args: {} });
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
      />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SparklesIcon className="size-8" />
          </EmptyMedia>
          <EmptyTitle>Welcome to LLM Space 4</EmptyTitle>
          <EmptyDescription>
            Create an Agent Project, start from a ready example, or open a blank
            thread.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          <Button onClick={onNewStarter}>
            <SparklesIcon />
            Start from examples
          </Button>
          <Button onClick={onNewFile} variant="outline">
            <PlusIcon />
            Blank thread
          </Button>
          <Button
            onClick={() => { executeCommand({ type: "createAgentProject", args: {} }); }}
            variant="outline"
          >
            <BotIcon />
            Create agent project
          </Button>
          <Button onClick={onModels} variant="outline">
            <SettingsIcon />
            Configure models
          </Button>
          <Button
            onClick={() => { executeCommand({ type: "openExternalAgentProject", args: {} }); }}
            variant="outline"
          >
            <FolderOpenIcon />
            Open Agent Project
          </Button>
        </EmptyContent>
        <Button
          asChild
          className="text-muted-foreground"
          size="sm"
          variant="link"
        >
          <a href="#" onClick={handleLearnMore}>
            Learn more <ArrowUpRightIcon />
          </a>
        </Button>
      </Empty>
    </div>
  );
}
