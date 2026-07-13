import {
  BotIcon,
  CopyIcon,
  FileTextIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { externalAgentProjects } from "@/client";
import { useCommands, useRegisterCommands } from "@/commands";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Tooltip } from "@/components/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { electrobun } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import type { ExternalAgentProjectSummary } from "@/shared/external-agent-project";

function _ExternalAgentProjectsPanel({
  className,
  refreshNonce,
  onOpenProject,
  onOpenThread,
}: {
  className?: string;
  refreshNonce: number;
  onOpenProject: (project: ExternalAgentProjectSummary) => void;
  onOpenThread: (
    project: ExternalAgentProjectSummary,
    thread: { id: string; title: string }
  ) => void;
}) {
  const [projects, setProjects] = useState<ExternalAgentProjectSummary[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<{
    projectId: string;
    threadId: string;
    title: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<{
    projectId: string;
    threadId: string;
    value: string;
  } | null>(null);
  const { executeCommand } = useCommands();

  const refresh = useCallback(async () => {
    try {
      setProjects(await externalAgentProjects.list());
    } catch (error) {
      toast.error("Unable to load Agent Projects", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshNonce]);

  useEffect(() => {
    const rpc = electrobun.rpc;
    if (!rpc) return;
    const listener = () => void refresh();
    rpc.addMessageListener("externalAgentProjectChanged", listener);
    return () =>
      rpc.removeMessageListener("externalAgentProjectChanged", listener);
  }, [refresh]);

  useRegisterCommands({
    createExternalAgentProjectThread: async ({ projectId }) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      const { id, record } =
        await externalAgentProjects.createThread(projectId);
      await refresh();
      onOpenThread(project, {
        id,
        title: record.thread.title ?? "untitled",
      });
    },
    refreshExternalAgentProject: async ({ projectId }) => {
      await externalAgentProjects.refresh(projectId);
      await refresh();
    },
    revealExternalAgentProject: async ({ path }) => {
      await electrobun.rpc?.request.revealAbsolutePath({ path });
    },
    removeExternalAgentProject: async ({ projectId }) => {
      await externalAgentProjects.remove(projectId);
      await refresh();
    },
    renameExternalAgentProjectThread: async ({
      projectId,
      threadId,
      title,
    }) => {
      const record = await externalAgentProjects.readThread(
        projectId,
        threadId
      );
      await externalAgentProjects.writeThread(projectId, threadId, {
        ...record,
        thread: { ...record.thread, title },
      });
      await refresh();
    },
    duplicateExternalAgentProjectThread: async ({ projectId, threadId }) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      const { id, record } = await externalAgentProjects.duplicateThread(
        projectId,
        threadId
      );
      await refresh();
      onOpenThread(project, {
        id,
        title: record.thread.title ?? "untitled",
      });
    },
    deleteExternalAgentProjectThread: async ({ projectId, threadId }) => {
      await externalAgentProjects.deleteThread(projectId, threadId);
      await refresh();
    },
  });

  return (
    <section className={cn("border-border/70 border-t", className)}>
      <header className="flex h-9 items-center gap-2 px-3">
        <BotIcon className="text-primary size-3.5" />
        <h2 className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Agent Projects
        </h2>
        <Tooltip content="Open Agent Project…">
          <Button
            className="ml-auto"
            size="icon-sm"
            variant="ghost"
            aria-label="Open Agent Project"
            onClick={() =>
              executeCommand({ type: "openExternalAgentProject", args: {} })
            }
          >
            <FolderOpenIcon />
          </Button>
        </Tooltip>
      </header>
      <div className="max-h-72 overflow-y-auto px-1 pb-2">
        {projects.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">
            Open a directory containing llm-space.json.
          </p>
        ) : (
          projects.map((project) => {
            const open = expanded.has(project.id);
            return (
              <div key={project.id}>
                <div className="group flex min-w-0 items-center rounded-md hover:bg-white/5">
                  <button
                    type="button"
                    className="focus-visible:ring-ring/30 flex min-w-0 grow items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-2"
                    onClick={() => {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);
                        return next;
                      });
                      onOpenProject(project);
                    }}
                  >
                    <BotIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        project.status === "ready"
                          ? "text-primary"
                          : "text-destructive"
                      )}
                    />
                    <span className="truncate">{project.name}</span>
                    <span className="text-muted-foreground ml-auto text-[9px]">
                      {project.status === "ready" ? "Watching" : project.status}
                    </span>
                  </button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`New Thread in ${project.name}`}
                    onClick={() =>
                      executeCommand({
                        type: "createExternalAgentProjectThread",
                        args: { projectId: project.id },
                      })
                    }
                  >
                    <PlusIcon />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`More actions for ${project.name}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          executeCommand({
                            type: "refreshExternalAgentProject",
                            args: { projectId: project.id },
                          })
                        }
                      >
                        <RefreshCwIcon /> Refresh
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          executeCommand({
                            type: "revealExternalAgentProject",
                            args: { path: project.path },
                          })
                        }
                      >
                        <FolderOpenIcon /> Reveal in Finder
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() =>
                          executeCommand({
                            type: "removeExternalAgentProject",
                            args: { projectId: project.id },
                          })
                        }
                      >
                        <UnplugIcon /> Remove from Desktop
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {open ? (
                  <div className="ml-5 border-l pl-1">
                    {project.threads.map((thread) => (
                      <div
                        key={thread.id}
                        className="group/thread flex min-w-0 items-center"
                      >
                        {renaming?.threadId === thread.id &&
                        renaming.projectId === project.id ? (
                          <input
                            autoFocus
                            className="border-input bg-background h-7 min-w-0 grow rounded border px-2 text-xs outline-none focus:ring-2"
                            value={renaming.value}
                            onChange={(event) =>
                              setRenaming({
                                ...renaming,
                                value: event.target.value,
                              })
                            }
                            onBlur={() => setRenaming(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setRenaming(null);
                                return;
                              }
                              if (event.key !== "Enter") return;
                              const title = renaming.value.trim();
                              if (!title) return;
                              event.preventDefault();
                              executeCommand({
                                type: "renameExternalAgentProjectThread",
                                args: {
                                  projectId: project.id,
                                  threadId: thread.id,
                                  title,
                                },
                              });
                              setRenaming(null);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="hover:bg-muted focus-visible:ring-ring/30 flex min-w-0 grow items-center gap-2 rounded px-2 py-1 text-left text-xs outline-none focus-visible:ring-2"
                            onClick={() => onOpenThread(project, thread)}
                          >
                            <FileTextIcon className="text-muted-foreground size-3.5" />
                            <span className="truncate">{thread.title}</span>
                          </button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className="opacity-0 group-hover/thread:opacity-100"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`More actions for ${thread.title}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                setRenaming({
                                  projectId: project.id,
                                  threadId: thread.id,
                                  value: thread.title,
                                })
                              }
                            >
                              <PencilIcon /> Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                executeCommand({
                                  type: "duplicateExternalAgentProjectThread",
                                  args: {
                                    projectId: project.id,
                                    threadId: thread.id,
                                  },
                                })
                              }
                            >
                              <CopyIcon /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setDeleting({
                                  projectId: project.id,
                                  threadId: thread.id,
                                  title: thread.title,
                                })
                              }
                            >
                              <Trash2Icon /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete “${deleting?.title ?? "Thread"}”?`}
        description="This removes the desktop-owned Thread and its run history. Agent Project source is not changed."
        confirmLabel="Delete Thread"
        onConfirm={() => {
          if (!deleting) return;
          executeCommand({
            type: "deleteExternalAgentProjectThread",
            args: {
              projectId: deleting.projectId,
              threadId: deleting.threadId,
            },
          });
          setDeleting(null);
        }}
      />
    </section>
  );
}

export const ExternalAgentProjectsPanel = memo(_ExternalAgentProjectsPanel);
