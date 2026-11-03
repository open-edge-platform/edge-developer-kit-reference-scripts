// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowDown, ArrowUp } from "lucide-react";
import type { Level } from "@/lib/wayfinding/types";
import { cn } from "@/lib/utils";
import { ROUTE_COLOR } from "./map-3d-world";

/** `at` is the visitor's floor, `to` where the lift or escalator they are taking lets them off, `pass` a floor the lift passes. */
export type FloorRole = "at" | "to" | "floor" | "pass";

const FLOOR_TILE = "#1e293b";

const short = (level: Level) => level.shortName ?? String(level.ordinal);

export function FloorTag({ level, role, up, compact }: { level: Level; role: FloorRole; up: boolean; compact?: boolean }) {
  if (role === "pass") {
    return (
      <span
        className="flex size-9 items-center justify-center rounded-xl border-2 border-white bg-slate-800/80 text-lg font-bold text-white shadow-md"
        data-testid={`floor-tag-${role}`}
      >
        {short(level)}
      </span>
    );
  }
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-2xl bg-white/95 p-1.5 pr-4 whitespace-nowrap shadow-[0_2px_10px_rgba(16,48,46,0.3)]",
        compact && "origin-left scale-75",
      )}
      style={role === "at" ? { boxShadow: `0 0 0 3px ${ROUTE_COLOR}, 0 2px 10px rgba(16,48,46,0.3)` } : undefined}
      data-testid={`floor-tag-${role}`}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-xl font-black text-white",
          role === "floor" ? "size-10 text-xl" : "size-12 text-[28px]",
        )}
        style={{ background: role === "at" ? ROUTE_COLOR : FLOOR_TILE }}
      >
        {short(level)}
      </span>
      <span className="flex flex-col leading-tight">
        {role !== "floor" && (
          <span
            className="flex items-center gap-0.5 text-[11px] font-bold tracking-wider uppercase"
            style={{ color: role === "at" ? ROUTE_COLOR : "#475569" }}
          >
            {role === "at" ? (
              "You're on"
            ) : (
              <>
                <Arrow className="size-3" strokeWidth={3} />
                {up ? "Going up to" : "Going down to"}
              </>
            )}
          </span>
        )}
        <span className={cn("font-bold text-slate-900", role === "floor" ? "text-[15px]" : "text-lg")}>{level.name}</span>
        {level.subtitle && !compact && <span className="max-w-52 truncate text-xs text-slate-500">{level.subtitle}</span>}
      </span>
    </div>
  );
}

/** Rides with the lift car: the floor it is passing, which way it goes, and where it stops. */
export function LiftDisplay({ at, to, compact }: { at: Level; to: Level; compact?: boolean }) {
  const arrived = at.index === to.index;
  const Arrow = to.index > at.index ? ArrowUp : ArrowDown;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border-2 border-white/80 bg-slate-900/95 py-2 pr-4 pl-3 whitespace-nowrap text-white shadow-xl",
        compact && "origin-right scale-75",
      )}
      data-testid="lift-display"
    >
      <span className="flex items-center gap-1">
        {!arrived && <Arrow className="size-7 text-emerald-300" strokeWidth={3} />}
        <span className="min-w-7 text-center text-4xl leading-none font-black tabular-nums">{short(at)}</span>
      </span>
      <span className="h-10 w-px bg-white/25" />
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          {arrived ? "Get out here" : "Going to"}
        </span>
        <span className="text-lg font-bold">{to.name}</span>
      </span>
    </div>
  );
}
