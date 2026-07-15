"use client";

import {
  CableIcon,
  FunctionSquareIcon,
  PackageCheckIcon,
  PlusIcon
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type {
  FunctionTool,
  ProjectTool,
  Tool
} from "@llm-space/core";

import {
  useThreadStore,
  useThreadStoreActions
} from "@/components/thread-playground/stores/thread-store";
import { useAutoAnimation } from "@/lib/use-auto-animation";
import { cn } from "@/lib/utils";
import { BuiltInToolImportDialog } from "./built-in-tool-import-dialog";
import { McpToolImportDialog } from "./mcp-tool-import-popover";
import { ToolEditorDialog } from "./tool-editor-dialog";
import { ToolListItem } from "./tool-list-item";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../ui/dropdown-menu";

export function ToolListView({
  className,
  readonly,
  onOpenProjectTool
}: {
  readonly className?: string;
  readonly onOpenProjectTool?: (tool: ProjectTool) => void;
  readonly readonly?: boolean;
}) {
  const tools = useThreadStore(s => s.thread.context?.tools);
  const { addTool, removeTool } = useThreadStoreActions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [builtInOpen, setBuiltInOpen] = useState(false);
  const [initialMcpServerId, setInitialMcpServerId] = useState<string | null>(
    null
  );
  const [initialMcpToolName, setInitialMcpToolName] = useState<string | null>(
    null
  );
  const [initialBuiltInToolName, setInitialBuiltInToolName] = useState<
    string | null
  >(null);
  const [editingTool, setEditingTool] = useState<FunctionTool | null>(null);
  const existingToolNames = useMemo(
    () => new Set((tools ?? []).map(tool => tool.name)),
    [tools]
  );

  const [animationContainerRef] = useAutoAnimation({ duration: 150 });

  const openAddDialog = useCallback(() => {
    setEditingTool(null);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((tool: Tool) => {
    if (tool.type === "mcp") {
      setInitialMcpServerId(tool.serverId);
      setInitialMcpToolName(tool.name);
      setMcpOpen(true);
      return;
    }
    if (tool.type === "builtin") {
      setInitialBuiltInToolName(tool.name);
      setBuiltInOpen(true);
      return;
    }
    if (tool.type === "project") {
      onOpenProjectTool?.(tool);
      return;
    }
    setEditingTool(tool);
    setDialogOpen(true);
  }, [onOpenProjectTool]);

  const handleRemoveTool = useCallback(
    (tool: Tool) => {
      removeTool(tool.name);
    },
    [removeTool]
  );

  return (
    <>
      <div
        className={cn("group flex min-w-0 grow flex-wrap gap-2.5", className)}
        ref={animationContainerRef}
      >
        {tools?.map(t => (
          <ToolListItem
            key={t.name}
            onEdit={openEditDialog}
            onRemove={handleRemoveTool}
            projectSourceNavigable={Boolean(onOpenProjectTool)}
            readonly={readonly}
            tool={t}
          />
        ))}
        {!onOpenProjectTool
          ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className={cn(
                    "-ml-1 px-0 transition-opacity hover:bg-transparent!",
                    readonly ? "opacity-30!" : "opacity-50"
                  )}
                  disabled={readonly}
                  size="sm"
                  variant="ghost"
                >
                  <PlusIcon className="size-3" />
                  Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => {
                    setInitialBuiltInToolName(null);
                    setBuiltInOpen(true);
                  }}
                >
                  <PackageCheckIcon />
                  Add Built-in Tools
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setInitialMcpServerId(null);
                    setInitialMcpToolName(null);
                    setMcpOpen(true);
                  }}
                >
                  <CableIcon />
                  Add MCP Tools
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={openAddDialog}>
                  <FunctionSquareIcon />
                  Add Custom Function Tool
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
          : null}
        <McpToolImportDialog
          existingToolNames={existingToolNames}
          initialServerId={initialMcpServerId}
          initialToolName={initialMcpToolName}
          onAdd={addTool}
          onOpenChange={open => {
            setMcpOpen(open);
            if (!open) {
              setInitialMcpServerId(null);
              setInitialMcpToolName(null);
            }
          }}
          onRemove={removeTool}
          open={mcpOpen}
        />
        <BuiltInToolImportDialog
          existingToolNames={existingToolNames}
          initialToolName={initialBuiltInToolName}
          onAdd={addTool}
          onOpenChange={open => {
            setBuiltInOpen(open);
            if (!open) {
              setInitialBuiltInToolName(null);
            }
          }}
          onRemove={removeTool}
          open={builtInOpen}
        />
      </div>
      <ToolEditorDialog
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        tool={editingTool}
      />
    </>
  );
}
