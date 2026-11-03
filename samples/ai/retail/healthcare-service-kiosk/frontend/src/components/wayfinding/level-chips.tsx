// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import type { LoadedMap } from "@/lib/wayfinding/types";
import { cn } from "@/lib/utils";

/** The width the floor picker takes down the left of a map, with its margin. */
export const FLOOR_CHIPS = 72;

export function LevelChips({
  map,
  activeId,
  onChange,
  routeLevels,
}: {
  map: LoadedMap;
  activeId: string;
  onChange: (id: string) => void;
  routeLevels?: string[];
}) {
  const levels = [...map.levels].reverse();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const chip = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (list && chip) list.scrollTop = chip.offsetTop - (list.clientHeight - chip.offsetHeight) / 2;
  }, [activeId]);
  return (
    <div
      ref={listRef}
      className="pointer-events-auto relative flex max-h-full flex-col gap-1 self-start overflow-y-auto rounded-2xl border bg-card/95 p-1 shadow-md"
    >
      {levels.map((level) => {
        const active = level.id === activeId;
        const onRoute = routeLevels?.includes(level.id);
        return (
          <button
            key={level.id}
            onClick={() => onChange(level.id)}
            aria-label={level.subtitle ? `${level.name}, ${level.subtitle}` : level.name}
            aria-pressed={active}
            className={cn(
              "relative h-12 min-w-12 shrink-0 rounded-xl px-2 text-sm font-bold transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : onRoute
                  ? "text-primary hover:bg-accent"
                  : "text-muted-foreground hover:bg-accent",
            )}
          >
            {level.shortName ?? level.ordinal}
            {onRoute && !active && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
