// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TapCard } from "./tap-card";
import { TONE_SURFACE, type Tone } from "./tone";

/** Rounded state chip, e.g. an expiry date or an application status. */
export function StatusPill({
  tone,
  className,
  children,
}: {
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type Props = {
  icon: LucideIcon;
  title: string;
  subtitle: React.ReactNode;
  status: { label: string; tone: Tone };
  selected: boolean;
  onSelect: () => void;
  /** On record but not actionable — shown greyed out and inert. */
  unavailable?: boolean;
};

/**
 * One row in a list of registry records (a vehicle, a driving license): glyph,
 * identifier, details, and a status chip on the right.
 */
export function RecordCard({
  icon: Icon,
  title,
  subtitle,
  status,
  selected,
  onSelect,
  unavailable = false,
}: Props) {
  return (
    <TapCard
      onClick={unavailable ? undefined : onSelect}
      selected={selected}
      aria-disabled={unavailable}
      className={cn(
        "flex items-center gap-5 rounded-[20px] p-6 text-left",
        unavailable && "cursor-not-allowed opacity-60",
      )}
    >
      <Icon className="size-9 shrink-0 text-primary" strokeWidth={1.7} />
      <div className="min-w-0 flex-1">
        <div className="text-xl font-bold">{title}</div>
        <div className="truncate text-base text-muted-foreground">{subtitle}</div>
      </div>
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
    </TapCard>
  );
}
