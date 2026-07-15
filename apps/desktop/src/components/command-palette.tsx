"use client";

import { useCommands } from "@/commands";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  type Command as AppCommand,
  COMMAND_META,
  type CommandType
} from "@/shared/commands";

const EMPTY_BLACKLIST: string[] = [];

/**
 * The ⌘⇧P command palette. Lists every registered command (from
 * {@link COMMAND_META}) and runs the selected one. Commands are shown by
 * label only — no icons, no shortcuts. Pass `blacklist` to hide commands that
 * need context the palette can't provide (e.g. a file path).
 */
export function CommandPalette({
  open,
  onOpenChange,
  blacklist = EMPTY_BLACKLIST
}: {
  readonly blacklist?: string[];
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const { executeCommand } = useCommands();

  const types = (Object.keys(COMMAND_META) as CommandType[]).filter(
    type => !blacklist.includes(type)
  );

  const run = (type: CommandType) => {
    onOpenChange(false);
    // Palette commands run with default (empty) args; context-dependent ones
    // are expected to be filtered out via `blacklist`.
    executeCommand({ type, args: {} } as AppCommand);
  };

  return (
    <CommandDialog onOpenChange={onOpenChange} open={open}>
      <Command>
        <CommandInput placeholder="Search commands..." />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          {types.map(type => (
            <CommandItem key={type} onSelect={() => { run(type); }}>
              {COMMAND_META[type].label}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
