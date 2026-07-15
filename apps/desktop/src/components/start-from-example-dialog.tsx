"use client";

import { SparklesIcon } from "lucide-react";

import {
  isPromptExample,
  PROMPT_EXAMPLES,
  type PromptExample
} from "@/components/thread-playground/examples/prompts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "./markdown";

export function StartFromExampleDialog({
  open,
  onOpenChange,
  onSelectExample
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelectExample: (example: PromptExample) => void;
  readonly open: boolean;
}) {
  const selectExample = (example: PromptExample) => {
    onOpenChange(false);
    onSelectExample(example);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-xl! overflow-hidden"
        onInteractOutside={e => { e.preventDefault(); }}
        onPointerDownOutside={e => { e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-3.5" /> Start from examples
          </DialogTitle>
          <DialogDescription className="pl-5.5">
            Choose a prompt example to create a new thread.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[80vh]">
          <ItemGroup className="gap-1 pr-3">
            {PROMPT_EXAMPLES.map((item, index) => {
              if (!isPromptExample(item)) {
                return <ItemSeparator className="my-1" key={`sep-${index}`} />;
              }
              const Icon = item.icon;
              return (
                <Item
                  asChild
                  className="hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  key={item.id}
                  variant="default"
                >
                  <button onClick={() => { selectExample(item); }} type="button">
                    <ItemMedia variant="icon">
                      <Icon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{item.label}</ItemTitle>
                      <ItemDescription>
                        <Markdown>{item.description}</Markdown>
                      </ItemDescription>
                    </ItemContent>
                  </button>
                </Item>
              );
            })}
          </ItemGroup>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
