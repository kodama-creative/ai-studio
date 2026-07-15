"use client";

import { SparklesIcon } from "lucide-react";
import { memo } from "react";

import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface SkillListItemProps {
  readonly name: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

const _SkillListItem = function SkillListItem({
  name,
  description,
  checked,
  disabled,
  onCheckedChange
}: SkillListItemProps) {
  return (
    <Item size="sm" variant="muted">
      <ItemMedia>
        <SparklesIcon className="text-muted-foreground size-4" />
      </ItemMedia>
      <ItemContent className={cn(!checked && "opacity-50")}>
        <ItemTitle>{name}</ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      <Switch
        aria-label={checked ? `Disable ${name}` : `Enable ${name}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        size="sm"
      />
    </Item>
  );
};

export const SkillListItem = memo(_SkillListItem);
