"use client";

import type { SkillInfo, SkillsSettings } from "@llm-space/core";
import { ConfirmDialog } from "@llm-space/ui/components/confirm-dialog";
import { SkillListItem } from "@llm-space/ui/components/skill-list-item";
import { useAutoAnimation } from "@llm-space/ui/lib/use-auto-animation";
import { cn } from "@llm-space/ui/lib/utils";
import { Button } from "@llm-space/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@llm-space/ui/ui/dropdown-menu";
import { ScrollArea } from "@llm-space/ui/ui/scroll-area";
import {
  Ban,
  CheckCheck,
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { SkillsSettingsController } from "@/app/settings/skills-settings-controller";
import { createNativeDialogsClient } from "@/client/native-dialogs";
import { createNativeFilesClient } from "@/client/native-files";
import { createSkillsClient } from "@/client/skills";

import { SettingsPage } from "./settings-page";

const _isWindows =
  typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);

/**
 * The OS file manager's name, for the "Reveal in …" menu label. Windows calls
 * it Explorer; macOS (and our Linux fallback) say Finder.
 */
const REVEAL_LABEL = _isWindows ? "Reveal in Explorer" : "Reveal in Finder";

export function SkillsPage() {
  const client = useMemo(() => createSkillsClient(), []);
  const dialogs = useMemo(() => createNativeDialogsClient(), []);
  const nativeFiles = useMemo(() => createNativeFilesClient(), []);
  const controller = useMemo(
    () =>
      new SkillsSettingsController({
        client,
        browseForPath: () => dialogs.pickDirectory(),
        revealPath: (path) => nativeFiles.reveal(path),
        notifyError: (title, error) => {
          toast.error(title, {
            description:
              error instanceof Error ? error.message : "Please try again.",
          });
        },
      }),
    [client, dialogs, nativeFiles]
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return (
    <SettingsPage
      className="flex size-full min-h-0"
      title="Skills"
      description={
        <>
          These settings only apply to the built-in <code>skill()</code> tool.
        </>
      }
    >
      <PathList
        paths={snapshot.settings.discoveryPaths}
        selectedPath={snapshot.selectedPath}
        loading={snapshot.loadingSettings}
        onSelect={(path) => controller.selectPath(path)}
        onAdd={() => void controller.addFolder()}
        onRemove={(path) => void controller.removeFolder(path)}
        onReveal={(path) => void controller.revealFolder(path)}
        onEnableAll={(path) => void controller.setAllEnabled(path, true)}
        onDisableAll={(path) => void controller.setAllEnabled(path, false)}
      />
      <PathSkills
        path={snapshot.selectedPath}
        skills={snapshot.skills}
        onToggle={(name, enabled) =>
          void controller.setSkillEnabled(name, enabled)
        }
        onOpenSkill={(skill) => void controller.revealSkill(skill)}
      />
    </SettingsPage>
  );
}

function PathList({
  paths,
  selectedPath,
  loading,
  onSelect,
  onAdd,
  onRemove,
  onReveal,
  onEnableAll,
  onDisableAll,
}: {
  paths: SkillsSettings["discoveryPaths"];
  selectedPath: string | null;
  loading: boolean;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
  onReveal: (path: string) => void;
  onEnableAll: (path: string) => void;
  onDisableAll: (path: string) => void;
}) {
  const [listRef] = useAutoAnimation<HTMLDivElement>();

  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 border-r pr-4">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        FOLDERS
      </span>

      <ScrollArea className="min-h-0 grow">
        {loading && paths.length === 0 ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Loading folders…
          </div>
        ) : paths.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
            No folders yet. Click the &quot;Add folder&quot; button below to get
            started.
          </div>
        ) : (
          <div ref={listRef} className="flex flex-col gap-1 pr-2">
            {paths.map((entry) => (
              <PathListItem
                key={entry.path}
                path={entry.path}
                selected={entry.path === selectedPath}
                onSelect={() => onSelect(entry.path)}
                onRemove={() => onRemove(entry.path)}
                onReveal={() => onReveal(entry.path)}
                onEnableAll={() => onEnableAll(entry.path)}
                onDisableAll={() => onDisableAll(entry.path)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <Button variant="outline" className="w-full" onClick={onAdd}>
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
  onReveal,
  onEnableAll,
  onDisableAll,
}: {
  path: string;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onReveal: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Select ${path}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
        selected ? "bg-muted font-medium" : "hover:bg-muted/50"
      )}
    >
      <Folder className="text-muted-foreground size-4 shrink-0" />
      <span className="line-clamp-1 grow break-all" title={path}>
        {path}
      </span>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label={`${path} folder actions`}
            title={`${path} folder actions`}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded",
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={onReveal}>
            <FolderOpen />
            {REVEAL_LABEL}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onEnableAll()}>
            <CheckCheck />
            Enable all skills
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDisableAll()}>
            <Ban />
            Disable all skills
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmOpen(true)}
          >
            <Trash2 />
            Remove {path}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove folder?"
        description={`This removes "${path}" from your skill discovery folders. You can add it back later.`}
        confirmLabel="Remove"
        dimBackground={false}
        onConfirm={() => {
          setConfirmOpen(false);
          onRemove();
        }}
      />
    </div>
  );
}

function PathSkills({
  path,
  skills,
  onToggle,
  onOpenSkill,
}: {
  path: string | null;
  skills: readonly SkillInfo[] | null;
  onToggle: (name: string, enabled: boolean) => void;
  onOpenSkill: (skill: SkillInfo) => void;
}) {
  const [listRef] = useAutoAnimation<HTMLDivElement>();

  const content = useMemo(() => {
    if (!path) {
      return (
        <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
          Select or add a source from the left sidebar
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
          No skills found in this source.
        </div>
      );
    }
    return (
      <div ref={listRef} className="flex flex-col gap-1.5">
        {skills.map((skill) => (
          <SkillListItem
            key={skill.name}
            name={skill.name}
            description={skill.description}
            checked={skill.enabled}
            onTitleClick={() => onOpenSkill(skill)}
            onCheckedChange={(enabled) => onToggle(skill.name, enabled)}
          />
        ))}
      </div>
    );
  }, [listRef, onOpenSkill, onToggle, path, skills]);

  return (
    <div className="flex min-w-0 grow flex-col">
      <ScrollArea className="min-h-0 grow">
        <div className="flex flex-col gap-2 pr-4 pl-6">
          {content}
        </div>
      </ScrollArea>
    </div>
  );
}
