import { ChevronDown, type LucideIcon } from "lucide-react";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";

/** An entry that renders as a plain divider in the menu. */
interface SeparatorItem { type: "separator"; }

/** The minimum shape a selectable example item must provide to be rendered. */
interface ExampleItem { type: string; label: string; icon: LucideIcon; }

/**
 * The shared "Examples ▾" dropdown used by the system-prompt and tool editors.
 * Given a catalog of items (each either a `{ type: "separator" }` divider or an
 * object carrying a `label`/`icon`), it renders the trigger and menu and calls
 * `onSelect` with the picked (non-separator) item.
 */
export function ExamplesMenu<T extends ExampleItem>({
  items,
  onSelect,
  align = "end"
}: {
  readonly align?: "end" | "start";
  readonly items: ReadonlyArray<SeparatorItem | T>;
  readonly onSelect: (item: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          Examples
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((item, index) => {
          if (item.type === "separator") {
            return <DropdownMenuSeparator key={`sep-${index}`} />;
          }
          const example = item as T;
          const Icon = example.icon;
          return (
            <DropdownMenuItem
              key={example.label}
              onSelect={() => { onSelect(example); }}
            >
              <Icon />
              {example.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
