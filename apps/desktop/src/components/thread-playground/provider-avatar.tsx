import { memo, useMemo } from "react";

import { PROVIDER_ICON_ALIASES, resolveProviderIcon } from "@/lib/brand-icons";
import { BrandAvatar } from "./brand-avatar";

const _ProviderAvatar = function ProviderAvatar({
  id,
  name,
  icon,
  size = 18,
  className
}: {
  readonly id: string;
  readonly name: string;

  readonly className?: string;

  /** A `@lobehub/icons` keyword overriding the auto-resolved brand icon. */
  readonly icon?: string;
  readonly size?: number;
}) {
  // An explicit `icon` wins; otherwise fall back to a known builtin alias, then
  // auto-resolving from the id and display name.
  const brand = useMemo(
    () => resolveProviderIcon(icon, PROVIDER_ICON_ALIASES[id], id, name),
    [icon, id, name]
  );

  return (
    <BrandAvatar
      brand={brand}
      className={className}
      colorClassName="text-foreground/80"
      fallbackClassName="rounded-md text-[9px]"
      id={id}
      name={name}
      size={size}
    />
  );
};

export const ProviderAvatar = memo(_ProviderAvatar);
