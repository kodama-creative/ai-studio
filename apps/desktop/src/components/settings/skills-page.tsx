"use client";

import {
  Ban,
  CheckCheck,
  Folder,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  addSkillsPath,
  browseForSkillsPath,
  getSkillsSettings,
  listSkills,
  removeSkillsPath,
  setAllSkillsHidden,
  setSkillHidden
} from "@/client/skills";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useAutoAnimation } from "@/lib/use-auto-animation";
import { cn } from "@/lib/utils";
import { SettingsPage } from "./settings-page";
import { ConfirmDialog } from "../confirm-dialog";
import { SkillListItem } from "../skill-list-item";
import { ScrollArea } from "../ui/scroll-area";

import type { SkillInfo, SkillsSettings } from "@/shared/skills";

export function SkillsPage() {
  const [settings, setSettings] = useState<SkillsSettings>({
    discoveryPaths: []
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Bumped after a bulk enable/disable so the skills pane refetches.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getSkillsSettings()
      .then(loaded => {
        if (!cancelled) {
          setSettings(loaded);
        }
      })
      .catch(() => {
        // A load failure is non-fatal; leave the list empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const paths = settings.discoveryPaths;
  const firstPath = paths[0]?.path ?? null;
  const effectiveSelectedPath =
    selectedPath && paths.some(entry => entry.path === selectedPath)
      ? selectedPath
      : firstPath;

  const handleAdd = useCallback(async () => {
    try {
      const path = await browseForSkillsPath();
      if (!path) {
        return;
      }
      const next = await addSkillsPath(path);
      setSettings(next);
      setSelectedPath(path);
    } catch (error) {
      toast.error("Failed to add folder", {
        description:
          error instanceof Error ? error.message : "Please try again."
      });
    }
  }, []);

  const handleRemove = useCallback(async (path: string) => {
    try {
      setSettings(await removeSkillsPath(path));
    } catch (error) {
      toast.error("Failed to remove folder", {
        description:
          error instanceof Error ? error.message : "Please try again."
      });
    }
  }, []);

  const handleSetAll = useCallback(async (path: string, hidden: boolean) => {
    try {
      setSettings(await setAllSkillsHidden(path, hidden));
      // Refetch the skills pane so its switches reflect the bulk change.
      setReloadToken(token => token + 1);
    } catch (error) {
      toast.error(
        hidden ? "Failed to disable skills" : "Failed to enable skills",
        {
          description:
            error instanceof Error ? error.message : "Please try again."
        }
      );
    }
  }, []);

  return (
    <SettingsPage
      className="flex size-full min-h-0"
      description={
        <>
          These settings only apply to the built-in <code>skill()</code> tool.
        </>
      }
      title="Skills"
    >
      <PathList
        onAdd={() => void handleAdd()}
        onDisableAll={path => void handleSetAll(path, true)}
        onEnableAll={path => void handleSetAll(path, false)}
        onRemove={path => void handleRemove(path)}
        onSelect={setSelectedPath}
        paths={paths}
        selectedPath={effectiveSelectedPath}
      />
      <PathSkills
        key={`${effectiveSelectedPath}:${reloadToken}`}
        path={effectiveSelectedPath}
      />
    </SettingsPage>
  );
}

function PathList({
  paths,
  selectedPath,
  onSelect,
  onAdd,
  onRemove,
  onEnableAll,
  onDisableAll
}: {
  readonly onAdd: () => void;
  readonly onDisableAll: (path: string) => void;
  readonly onEnableAll: (path: string) => void;
  readonly onRemove: (path: string) => void;
  readonly onSelect: (path: string) => void;
  readonly paths: SkillsSettings["discoveryPaths"];
  readonly selectedPath: string | null;
}) {
  const [listRef] = useAutoAnimation<HTMLDivElement>();

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-r pr-4">
      <ScrollArea className="min-h-0 grow">
        {paths.length === 0
          ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
              No folders yet. Click the &quot;Add folder&quot; button below to get
              started.
            </div>
          )
          : (
            <div className="flex flex-col gap-1 pr-2" ref={listRef}>
              {paths.map(entry => (
                <PathListItem
                  key={entry.path}
                  onDisableAll={() => { onDisableAll(entry.path); }}
                  onEnableAll={() => { onEnableAll(entry.path); }}
                  onRemove={() => { onRemove(entry.path); }}
                  onSelect={() => { onSelect(entry.path); }}
                  path={entry.path}
                  selected={entry.path === selectedPath}
                />
              ))}
            </div>
          )}
      </ScrollArea>

      <Button className="w-full" onClick={onAdd} variant="outline">
        <Plus />
        Add folder
      </Button>
    </div>
  );
}

function PathListItem({
  path,
  selected,
  onSelect,
  onRemove,
  onEnableAll,
  onDisableAll
}: {
  readonly onDisableAll: () => void;
  readonly onEnableAll: () => void;
  readonly onRemove: () => void;
  readonly onSelect: () => void;
  readonly path: string;
  readonly selected: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div
      aria-label={`Select ${path}`}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
        selected ? "bg-muted font-medium" : "hover:bg-muted/50"
      )}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <Folder className="text-muted-foreground size-4 shrink-0" />
      <span className="line-clamp-1 grow break-all" title={path}>
        {path}
      </span>

      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            aria-label={`${path} folder actions`}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            )}
            onClick={e => { e.stopPropagation(); }}
            role="button"
            tabIndex={0}
            title={`${path} folder actions`}
          >
            <MoreHorizontal className="size-4" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={e => { e.stopPropagation(); }}>
          <DropdownMenuItem onSelect={() => { onEnableAll(); }}>
            <CheckCheck />
            Enable all skills
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { onDisableAll(); }}>
            <Ban />
            Disable all skills
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => { setConfirmOpen(true); }}
            variant="destructive"
          >
            <Trash2 />
            Remove {path}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        confirmLabel="Remove"
        description={`This removes "${path}" from your skill discovery folders. You can add it back later.`}
        dimBackground={false}
        onConfirm={() => {
          setConfirmOpen(false);
          onRemove();
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title="Remove folder?"
      />
    </div>
  );
}

function PathSkills({ path }: { readonly path: string | null; }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(() => (path ? null : []));
  const [listRef] = useAutoAnimation<HTMLDivElement>();

  useEffect(() => {
    if (!path) {
      return;
    }
    let cancelled = false;
    void listSkills(path)
      .then(loaded => {
        if (!cancelled) {
          setSkills(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkills([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const handleToggle = useCallback(
    async (name: string, enabled: boolean) => {
      if (!path) {
        return;
      }
      // Optimistically reflect the toggle.
      setSkills(prev =>
        (prev ? prev.map(s => (s.name === name ? { ...s, enabled } : s)) : prev));
      try {
        await setSkillHidden(path, name, !enabled);
      } catch (error) {
        // Roll back on failure.
        setSkills(prev =>
          (prev
            ? prev.map(s =>
              (s.name === name ? { ...s, enabled: !enabled } : s))
            : prev));
        toast.error("Failed to update skill", {
          description:
            error instanceof Error ? error.message : "Please try again."
        });
      }
    },
    [path]
  );

  const content = useMemo(() => {
    if (!path) {
      return (
        <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
          Select or add a folder from the left sidebar
        </div>
      );
    }
    if (skills === null) {
      return (
        <div className="text-muted-foreground flex items-center gap-2 px-1 py-6 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading skills…
        </div>
      );
    }
    if (skills.length === 0) {
      return (
        <div className="text-muted-foreground px-1 py-6 text-sm">
          No skills found in this folder.
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5" ref={listRef}>
        {skills.map(skill => (
          <SkillListItem
            checked={skill.enabled}
            description={skill.description}
            key={skill.name}
            name={skill.name}
            onCheckedChange={enabled => void handleToggle(skill.name, enabled)}
          />
        ))}
      </div>
    );
  }, [handleToggle, listRef, path, skills]);

  return (
    <div className="flex min-w-0 grow flex-col">
      <ScrollArea className="min-h-0 grow">
        <div className="flex flex-col gap-2 pr-4 pl-6">{content}</div>
      </ScrollArea>
    </div>
  );
}
