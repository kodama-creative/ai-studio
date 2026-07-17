"use client";

import {
  AGENT_PROJECT_PRESETS,
  type AgentProjectPreset,
  DEFAULT_AGENT_PROJECT_PRESETS,
  isAgentProjectMcpToolName,
  isAgentProjectMcpUrl,
  isAgentProjectName
} from "@llm-space/runtime";
import {
  BotIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PlugIcon,
  SparklesIcon,
  WrenchIcon
} from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { toast } from "sonner";

import { externalAgentProjects } from "@/client";
import { useCommands } from "@/commands";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { ExternalAgentProjectView } from "@/shared/external-agent-project";

const PRESET_META: Record<
  AgentProjectPreset,
  { description: string; icon: typeof WrenchIcon; label: string; }
> = {
  "local-tool": {
    label: "Local tool",
    description: "Add a deterministic echo tool.",
    icon: WrenchIcon
  },
  skill: {
    label: "Skill",
    description: "Add an independent concise-response skill.",
    icon: SparklesIcon
  },
  "mcp-connection": {
    label: "MCP connection",
    description: "Add an explicit Streamable HTTP connection.",
    icon: PlugIcon
  }
};

export function NewAgentProjectDialog({
  onCreated,
  onOpenChange,
  open
}: {
  readonly onCreated: (project: ExternalAgentProjectView) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const { executeCommand } = useCommands();
  const [name, setName] = useState("");
  const [parentDirectory, setParentDirectory] = useState("");
  const [presets, setPresets] = useState<AgentProjectPreset[]>(() => [
    ...DEFAULT_AGENT_PROJECT_PRESETS
  ]);
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpToolNames, setMcpToolNames] = useState("");
  const [choosingParent, setChoosingParent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mcpSelected = presets.includes("mcp-connection");
  const mcpTools = _mcpTools(mcpToolNames);
  const mcpValid = !mcpSelected || (
    isAgentProjectMcpUrl(mcpUrl.trim())
    && mcpTools.length > 0
    && mcpTools.every(isAgentProjectMcpToolName)
    && new Set(mcpTools).size === mcpTools.length
  );
  const canCreate = isAgentProjectName(name)
    && parentDirectory.length > 0
    && mcpValid
    && !creating;

  const reset = () => {
    setName("");
    setParentDirectory("");
    setPresets([...DEFAULT_AGENT_PROJECT_PRESETS]);
    setMcpUrl("");
    setMcpToolNames("");
    setChoosingParent(false);
    setCreating(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (creating) { return; }
    if (!next) { reset(); }
    onOpenChange(next);
  };

  const chooseParent = async () => {
    setChoosingParent(true);
    setError(null);
    try {
      const selected = await externalAgentProjects.browseCreateParent();
      if (selected) { setParentDirectory(selected.path); }
    } catch (selectionError) {
      setError(_message(selectionError));
    } finally {
      setChoosingParent(false);
    }
  };

  const togglePreset = (preset: AgentProjectPreset, checked: boolean) => {
    setPresets(current => AGENT_PROJECT_PRESETS.filter(candidate => {
      return candidate === preset ? checked : current.includes(candidate);
    }));
    setError(null);
  };

  const createProject = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) { return; }
    setCreating(true);
    setError(null);
    try {
      const project = await externalAgentProjects.create({
        name,
        parentDirectory,
        presets,
        ...(mcpSelected
          ? { mcpConnection: { url: mcpUrl.trim(), tools: mcpTools } }
          : {})
      });
      onCreated(project);
      onOpenChange(false);
      reset();
      toast.success("Agent Project created", {
        description: project.path,
        action: {
          label: "Reveal in Finder",
          onClick: () => {
            executeCommand({
              type: "revealExternalAgentProject",
              args: { path: project.path }
            });
          }
        }
      });
    } catch (creationError) {
      setError(_message(creationError));
      setCreating(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[90vh] max-w-xl! overflow-y-auto"
        onEscapeKeyDown={event => {
          if (creating) { event.preventDefault(); }
        }}
        onInteractOutside={event => { event.preventDefault(); }}
        onPointerDownOutside={event => { event.preventDefault(); }}
        showCloseButton={!creating}
      >
        <form className="grid gap-5" onSubmit={event => void createProject(event)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BotIcon className="size-4" /> New Agent Project
            </DialogTitle>
            <DialogDescription>
              Create portable source in a new user-owned directory.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="agent-project-name">
              Project name
            </label>
            <Input
              aria-describedby="agent-project-name-help"
              aria-invalid={name.length > 0 && !isAgentProjectName(name)}
              autoComplete="off"
              autoFocus
              disabled={creating}
              id="agent-project-name"
              onChange={event => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="my-agent"
              spellCheck={false}
              value={name}
            />
            <p className="text-muted-foreground text-xs" id="agent-project-name-help">
              Use lowercase letters, numbers, and single hyphens.
            </p>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Parent folder</span>
            <div className="flex min-w-0 gap-2">
              <Input
                aria-label="Selected parent folder"
                className="min-w-0"
                placeholder="Choose a parent folder"
                readOnly
                title={parentDirectory}
                value={parentDirectory}
              />
              <Button
                disabled={creating || choosingParent}
                onClick={() => void chooseParent()}
                type="button"
                variant="outline"
              >
                {choosingParent
                  ? <LoaderCircleIcon className="animate-spin" />
                  : <FolderOpenIcon />}
                Choose...
              </Button>
            </div>
            <p className="text-muted-foreground truncate text-xs" title={parentDirectory && name ? `${parentDirectory}/${name}` : undefined}>
              {parentDirectory && name
                ? `${parentDirectory}/${name}`
                : "The project directory must not already exist."}
            </p>
          </div>

          <fieldset className="grid gap-2" disabled={creating}>
            <legend className="mb-1 text-sm font-medium">Capabilities</legend>
            {AGENT_PROJECT_PRESETS.map(preset => {
              const meta = PRESET_META[preset];
              const Icon = meta.icon;
              const checked = presets.includes(preset);
              return (
                <label
                  className="border-border hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5"
                  key={preset}
                >
                  <input
                    aria-label={meta.label}
                    checked={checked}
                    className="accent-primary mt-0.5 size-4 shrink-0"
                    onChange={event => {
                      togglePreset(preset, event.target.checked);
                    }}
                    type="checkbox"
                  />
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {meta.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {mcpSelected
            ? (
              <div className="border-border bg-muted/20 grid gap-3 rounded-md border p-3">
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="agent-project-mcp-url">
                    MCP URL
                  </label>
                  <Input
                    aria-invalid={mcpUrl.length > 0 && !isAgentProjectMcpUrl(mcpUrl.trim())}
                    disabled={creating}
                    id="agent-project-mcp-url"
                    onChange={event => {
                      setMcpUrl(event.target.value);
                      setError(null);
                    }}
                    placeholder="https://mcp.example.com/tools"
                    spellCheck={false}
                    value={mcpUrl}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="agent-project-mcp-tools">
                    Allowed remote tools
                  </label>
                  <Input
                    aria-describedby="agent-project-mcp-tools-help"
                    aria-invalid={mcpToolNames.length > 0 && (
                      mcpTools.length === 0
                      || !mcpTools.every(isAgentProjectMcpToolName)
                    )}
                    disabled={creating}
                    id="agent-project-mcp-tools"
                    onChange={event => {
                      setMcpToolNames(event.target.value);
                      setError(null);
                    }}
                    placeholder="search, fetch_document"
                    spellCheck={false}
                    value={mcpToolNames}
                  />
                  <p className="text-muted-foreground text-xs" id="agent-project-mcp-tools-help">
                    Enter one or more exact names separated by commas. No network request is made during creation.
                  </p>
                </div>
              </div>
            )
            : null}

          {error
            ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )
            : null}

          <DialogFooter>
            <Button
              disabled={creating}
              onClick={() => { handleOpenChange(false); }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!canCreate} type="submit">
              {creating ? <LoaderCircleIcon className="animate-spin" /> : <BotIcon />}
              {creating ? "Creating..." : "Create agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function _mcpTools(value: string): string[] {
  return value.split(",").map(tool => tool.trim()).filter(Boolean);
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
