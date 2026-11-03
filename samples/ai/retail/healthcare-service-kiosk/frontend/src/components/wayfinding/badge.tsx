// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export type BadgeIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export const TRANSPORT_COLOR = "#1e293b";

type IconProps = { className?: string; strokeWidth?: number };

const svgProps = (className?: string, strokeWidth = 2) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

export function LiftIcon({ className, strokeWidth }: IconProps) {
  return (
    <svg {...svgProps(className, strokeWidth)}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="m8.5 9.5 3.5-3.5 3.5 3.5" />
      <path d="m8.5 14.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

export function EscalatorIcon({ className, strokeWidth }: IconProps) {
  return (
    <svg {...svgProps(className, strokeWidth)}>
      <path d="M2 20h5L17 8h5" />
      <circle cx="12.5" cy="5.2" r="1.7" />
      <path d="M12.5 8.4v4.4" />
    </svg>
  );
}

export function BadgeTile({ icon: Icon, color, ring, large }: { icon: BadgeIcon; color: string; ring?: boolean; large?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center text-white",
        large ? "size-10 rounded-xl" : "size-8 rounded-[10px]",
        ring && "border-[3px] border-white shadow-[0_2px_8px_rgba(16,48,46,0.3)]",
      )}
      style={{ background: color }}
    >
      <Icon className={large ? "size-6" : "size-5"} strokeWidth={2.2} />
    </span>
  );
}

/** A room's name printed on it, like a floor plan: plain text with a light halo, no pill. */
export function RoomName({ name }: { name: string }) {
  return (
    <span
      className="block max-w-32 text-center text-[12px] leading-tight font-semibold text-balance text-slate-700 [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_6px_#fff]"
      data-testid="room-name"
    >
      {name}
    </span>
  );
}

/** Tile and name in a pill; the name drops out when the label's `data-lod` is "icon". */
export function PlaceBadge({
  icon,
  color,
  name,
  destination,
}: {
  icon: BadgeIcon;
  color: string;
  name: string;
  destination?: boolean;
}) {
  return (
    <span className="flex flex-col items-center">
      <span
        className={cn(
          "flex items-center gap-2 rounded-2xl bg-white p-1 shadow-[0_2px_8px_rgba(16,48,46,0.28)] group-data-[lod=icon]:rounded-xl group-data-[lod=icon]:bg-transparent group-data-[lod=icon]:p-0 group-data-[lod=icon]:shadow-none",
          destination && "ring-4 ring-[#dc2626]",
        )}
      >
        <span className="group-data-[lod=icon]:rounded-[13px] group-data-[lod=icon]:border-[3px] group-data-[lod=icon]:border-white group-data-[lod=icon]:shadow-[0_2px_8px_rgba(16,48,46,0.3)]">
          <BadgeTile icon={icon} color={color} large={destination} />
        </span>
        <span
          className={cn(
            "pr-3 font-semibold whitespace-nowrap text-slate-800 group-data-[lod=icon]:hidden",
            destination ? "text-base" : "text-[13px]",
          )}
        >
          {name}
        </span>
      </span>
      {destination && <span className="-mt-px border-x-[9px] border-t-[10px] border-x-transparent border-t-[#dc2626]" />}
    </span>
  );
}
