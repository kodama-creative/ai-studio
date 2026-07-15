import { memo, useMemo } from "react";

import { resolveModelIcon } from "@/lib/brand-icons";
import { BrandAvatar } from "./brand-avatar";

const _ModelAvatar = function ModelAvatar({
  id,
  name,
  icon,
  size = 24,
  className
}: {
  readonly id: string;
  readonly name: string;

  readonly className?: string;

  /** A `@lobehub/icons` keyword overriding the auto-resolved brand icon. */
  readonly icon?: string;
  readonly size?: number;
}) {
  // An explicit `icon` wins; otherwise fall back to auto-resolving from the id
  // and display name.
  const brand = useMemo(
    () => resolveModelIcon(icon, id, name),
    [icon, id, name]
  );

  return (
    <BrandAvatar
      brand={brand}
      className={className}
      colorClassName="text-foreground/90"
      fallbackClassName="rounded-full text-xs"
      id={id}
      name={name}
      size={size}
    />
  );
};

export const ModelAvatar = memo(_ModelAvatar);
