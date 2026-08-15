"use client";

import type { Playground } from "@llm-space/studio";
import { Button } from "@llm-space/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@llm-space/ui/ui/empty";
import { Spinner } from "@llm-space/ui/ui/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2Icon, MessagesSquareIcon, PlusIcon } from "lucide-react";
import { memo, useEffect } from "react";
import { toast } from "sonner";

import { disposeBestEffort } from "@/app/lifecycle/dispose-best-effort";
import type { AgentProjectClient } from "@/client/agent-project-client";
import type { PlaygroundClient } from "@/client/playground-client";
import { useCommands } from "@/commands";

function _PlaygroundSidebar({
  client,
  projectClient,
  onOpen,
  onCreate,
}: {
  client: PlaygroundClient;
  projectClient: AgentProjectClient;
  onOpen: (playground: Playground) => void;
  onCreate: () => void;
}) {
  const queryClient = useQueryClient();
  const { executeCommand } = useCommands();
  const { data: playgrounds = [], isLoading: loadingPlaygrounds } = useQuery({
    queryKey: ["playgrounds"],
    queryFn: () => client.list(),
  });
  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["agent-projects"],
    queryFn: () => projectClient.list(),
  });

  useEffect(() => {
    const changed = projectClient.on("changed", () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-projects"] });
    });
    const failed = projectClient.on("openFailed", ({ message }) => {
      toast.error("Unable to open Agent Project", {
        description: message,
      });
    });
    return () => {
      disposeBestEffort(failed);
      disposeBestEffort(changed);
    };
  }, [projectClient, queryClient]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-border/70 flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-semibold">Playgrounds</span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New Playground"
          onClick={onCreate}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </header>
      {loadingPlaygrounds ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Spinner />
        </div>
      ) : playgrounds.length === 0 ? (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyTitle>No Playgrounds yet</EmptyTitle>
            <EmptyDescription>
              Create a Playground to define and debug an Agent.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={onCreate}>
              New Playground
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {playgrounds.map((playground) => (
            <button
              key={playground.id}
              type="button"
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() => onOpen(playground)}
            >
              <MessagesSquareIcon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">{playground.title}</span>
            </button>
          ))}
        </div>
      )}
      <header className="border-border/70 flex h-11 shrink-0 items-center justify-between border-y px-3">
        <span className="text-xs font-semibold">Projects / Experiments</span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open Agent Project"
          onClick={() =>
            executeCommand({ type: "agentProjects.open", args: {} })
          }
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </header>
      {loadingProjects ? (
        <div className="grid min-h-16 place-items-center">
          <Spinner />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-muted-foreground px-3 py-4 text-xs">
          Open an Agent Project to manage its Experiments.
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto p-2">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
              onClick={() =>
                executeCommand({
                  type: "agentProjects.open",
                  args: { rootPath: project.rootPath },
                })
              }
            >
              <FolderGit2Icon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export const PlaygroundSidebar = memo(_PlaygroundSidebar);
