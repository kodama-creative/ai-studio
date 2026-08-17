"use client";

import { SparklesIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "../lib/utils";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item";
import { Switch } from "../ui/switch";

import { Tooltip } from "./tooltip";

interface SkillListItemProps {
  name: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onTitleClick?: () => void;
  onCheckedChange: (checked: boolean) => void;
}

function _SkillListItem({
  name,
  description,
  checked,
  disabled,
  onTitleClick,
  onCheckedChange,
}: SkillListItemProps) {
  return (
    <Item variant="muted" size="sm">
      <ItemMedia>
        <SparklesIcon className="text-muted-foreground size-4" />
      </ItemMedia>
      <ItemContent className={cn("min-w-0", !checked && "opacity-50")}>
        <ItemTitle>
          {onTitleClick ? (
            <Tooltip content="Click to open the skill folder">
              <a
                type="button"
                className="cursor-pointer text-left"
                aria-label={`Open ${name} folder`}
                onClick={onTitleClick}
              >
                {name}
              </a>
            </Tooltip>
          ) : (
            name
          )}
        </ItemTitle>
        {description && (
          <ItemDescription className="wrap-anywhere">
            {description}
          </ItemDescription>
        )}
      </ItemContent>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={checked ? `Disable ${name}` : `Enable ${name}`}
      />
    </Item>
  );
}

export const SkillListItem = memo(_SkillListItem);
