"use client";

import {
  CableIcon,
  FunctionSquareIcon,
  PackageIcon,
  XIcon
} from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

import type { Tool } from "@llm-space/core";

import { cn } from "@/lib/utils";
import { getBuiltInToolIcon } from "./built-in-tool-icon";
import { Tooltip } from "../../tooltip";

const _ToolListItem = function ToolListItem({
  tool,
  readonly,
  onEdit,
  onRemove,
  projectSourceNavigable = false
}: {
  readonly readonly?: boolean;
  readonly tool: Tool;

  readonly onEdit: (tool: Tool) => void;

  readonly onRemove: (tool: Tool) => void;
  readonly projectSourceNavigable?: boolean;
}) {
  const keys = useMemo(
    () =>
      Object.keys(
        (tool.parameters as Record<string, unknown>).properties ?? {}
      ),
    [tool.parameters]
  );
  const required = useMemo(
    () => (tool.parameters as { required: string[]; }).required ?? [],
    [tool.parameters]
  );
  const handleRemove = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onRemove(tool);
    },
    [onRemove, tool]
  );
  const ToolIcon =
    tool.type === "mcp"
      ? CableIcon
      : tool.type === "builtin"
        ? getBuiltInToolIcon(tool)
        : tool.type === "project"
          ? PackageIcon
          : FunctionSquareIcon;
  const editDisabled =
    tool.type === "project" ? !projectSourceNavigable : readonly;

  return (
    <div className="group/tool bg-secondary hover:text-accent-foreground inline-flex h-6 shrink-0 items-center rounded-md text-xs/relaxed transition-colors">
      <Tooltip
        content={
          <div>
            <div className="font-mono">
              <span className="text-primary font-bold">{tool.name}</span>
              <span>(</span>
              <span className="whitespace-pre-wrap">
                {keys.length > 0
                  ? `{\n${
                    keys
                      .map(key =>
                        (required.includes(key) ? `  ${key}` : `  [${key}]`))
                      .join(", \n")
                  }\n}`
                  : ""}
              </span>
              <span>)</span>
            </div>
            {tool.description
              ? (
                <div className="pt-2 text-xs whitespace-pre-wrap opacity-60">
                  {tool.description}
                </div>
              )
              : null}
          </div>
        }
      >
        <span className="inline-flex h-full">
          <button
            aria-label={
              tool.type === "project"
                ? `Open source for ${tool.name} project tool`
                : tool.type === "function"
                  ? `Edit ${tool.name} tool`
                  : `Manage ${tool.name} ${tool.type === "mcp" ? "MCP" : "built-in"} tool`
            }
            className="focus-visible:ring-ring/30 text-muted-foreground group-hover/tool:text-foreground inline-flex h-full items-center gap-1 rounded-l-md pl-2 outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
            disabled={editDisabled}
            onClick={() => { onEdit(tool); }}
            type="button"
          >
            <ToolIcon className="size-3.5 shrink-0 opacity-70" />
            <span className="font-mono">{tool.name}</span>
          </button>
        </span>
      </Tooltip>
      <Tooltip content="Remove tool">
        <button
          aria-label={`Remove ${tool.name} tool`}
          className={cn(
            "text-muted-foreground hover:text-accent-foreground focus-visible:ring-ring/30 inline-flex h-full items-center rounded-r-md pr-1 pl-1 outline-none hover:opacity-100 focus-visible:ring-2",
            readonly ? "opacity-0!" : "opacity-0 group-hover/tool:opacity-100"
          )}
          disabled={readonly}
          onClick={handleRemove}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      </Tooltip>
    </div>
  );
};
export const ToolListItem = memo(_ToolListItem);
