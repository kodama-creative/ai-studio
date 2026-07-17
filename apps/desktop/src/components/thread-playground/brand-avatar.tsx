import { extractInitials } from "@llm-space/core";

import { cn } from "@/lib/utils";

import type { BrandIcon } from "@/lib/brand-icons";

/**
 * Shared avatar body for {@link ModelAvatar} and {@link ProviderAvatar}: renders
 * a resolved brand icon when one is found, else an initials placeholder backed by
 * `avatar.vercel.sh`. The two callers differ only in how they resolve `brand` and
 * in the color/shape classes they pass.
 */
export function BrandAvatar({
  brand,
  id,
  name,
  size,
  colorClassName,
  fallbackClassName,
  className
}: {
  readonly brand: BrandIcon | null;
  readonly id: string;
  readonly name: string;
  readonly size: number;

  /** Text color applied to both the brand icon and the fallback initials. */
  readonly colorClassName: string;

  readonly className?: string;

  /** Shape/typography for the initials fallback (e.g. `rounded-full text-xs`). */
  readonly fallbackClassName: string;
}) {
  if (brand) {
    const { Icon } = brand;
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center",
          colorClassName,
          className
        )}
        style={{ width: size, height: size }}
      >
        <Icon size={Math.round(size * 0.9)} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border-b bg-cover bg-no-repeat pt-0.5 text-shadow-2xs",
        colorClassName,
        fallbackClassName,
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(https://avatar.vercel.sh/${encodeURIComponent(id)}?size=${size})`
      }}
    >
      {extractInitials(name)}
    </div>
  );
}
