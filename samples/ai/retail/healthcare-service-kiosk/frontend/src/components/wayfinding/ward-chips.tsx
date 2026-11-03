// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { ChevronRight } from "lucide-react";
import { WARDS, type WardGroup } from "@/hospital/data";
import { cn } from "@/lib/utils";

const ROWS: { group: WardGroup; label: string }[] = [
  { group: "numbered", label: "Ward" },
  { group: "intensive", label: "Intensive care" },
  { group: "other", label: "Other wards" },
];

const CHIP =
  "inline-flex min-h-12 min-w-14 cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-input bg-background px-3 text-base font-bold text-ink tabular-nums transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Ward numbers and units as small chips, a row per kind of ward, labelled at
 * the side or, `stacked`, above. `onMore` ends with an "All wards" chip in
 * place of the other wards.
 */
export function WardChips({
  onPick,
  onMore,
  stacked,
}: {
  onPick: (wardId: string) => void;
  onMore?: () => void;
  stacked?: boolean;
}) {
  const rows = onMore ? ROWS.slice(0, 2) : ROWS;
  return (
    <div
      className={cn("grid gap-x-4", stacked ? "gap-y-1.5" : "grid-cols-[auto_minmax(0,1fr)] items-center gap-y-2.5")}
      data-testid="ward-chips"
    >
      {rows.map(({ group, label }, i) => (
        <div key={group} className="contents">
          <span className={cn("text-sm font-semibold text-muted-foreground", stacked && i > 0 && "mt-2")}>{label}</span>
          <div className="flex flex-wrap gap-2">
            {WARDS.filter((w) => w.group === group).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onPick(w.id)}
                aria-label={w.name}
                title={`${w.name} · ${w.care}`}
                className={CHIP}
              >
                {w.code ?? w.name}
              </button>
            ))}
            {onMore && i === rows.length - 1 && (
              <button type="button" onClick={onMore} className={cn(CHIP, "border-dashed pr-2 font-semibold")}>
                All wards
                <ChevronRight className="size-4 text-primary" aria-hidden />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
