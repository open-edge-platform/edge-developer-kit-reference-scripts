// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  /** Sizes the outer ring, e.g. "size-24". */
  className?: string;
  ringClassName?: string;
  iconClassName?: string;
  /** Freezes the ring — used to signal a stalled read rather than progress. */
  spinning?: boolean;
};

/** Icon framed by a rotating arc, shown while a peripheral or registry responds. */
export function SpinnerRing({
  icon: Icon,
  className,
  ringClassName,
  iconClassName,
  spinning = true,
}: Props) {
  return (
    <div className={cn("relative flex size-24 items-center justify-center", className)}>
      {spinning && (
        <>
          <div className="absolute -inset-3 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--cyan)_22%,transparent),transparent_68%)] blur-md" />
          <div
            className={cn(
              "absolute inset-0 animate-ks-spin rounded-full border-4 border-accent border-t-ring",
              ringClassName,
            )}
          />
          <div className="absolute inset-3 animate-ks-spin-rev rounded-full border-4 border-secondary border-b-violet" />
        </>
      )}
      <Icon className={cn("relative size-9 text-primary", iconClassName)} strokeWidth={1.7} />
    </div>
  );
}

/**
 * Full "checking the registry" panel: a spinning glyph over an explanation of
 * what is being looked up.
 */
export function LookupPending({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex animate-ks-fade flex-col items-center gap-6 py-12 text-center">
      <SpinnerRing icon={icon} />
      <div className="text-2xl font-bold tracking-tight">{title}</div>
      <div className="max-w-md text-lg text-pretty text-muted-foreground">{description}</div>
    </div>
  );
}
