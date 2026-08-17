"use client";

import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

/** Provides the common header and content layout for one variable editor. */
export function DetailShell({
  icon,
  title,
  action,
  children,
  className,
  contentClassName,
}: {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("grid w-full gap-5 p-5", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <div className="min-w-0 grow">
          <div className="truncate text-base font-medium">{title}</div>
        </div>
        {action}
      </div>
      <div className={cn("grid gap-4", contentClassName)}>{children}</div>
    </div>
  );
}
