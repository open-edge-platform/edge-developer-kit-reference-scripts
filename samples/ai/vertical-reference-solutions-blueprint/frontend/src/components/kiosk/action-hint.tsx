// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowDown, ArrowRight, Hand, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one-line "what do I do now?" prompt that sits between a step's heading
 * and its controls.
 *
 * Every screen in this kiosk asks the citizen for something, and the ask is
 * obvious to whoever built it and invisible to whoever is standing in a
 * queue. The pill states the action in plain words and points at where it
 * happens; the arrow keeps moving so it reads as an instruction rather than
 * another piece of furniture.
 */
export function ActionHint({
  icon: Icon = Hand,
  direction = "down",
  className,
  children,
}: {
  icon?: LucideIcon;
  /** Which way the citizen should look for the control being described. */
  direction?: "down" | "right" | "none";
  className?: string;
  children: React.ReactNode;
}) {
  const Arrow = direction === "right" ? ArrowRight : ArrowDown;
  return (
    <div
      className={cn(
        "mx-auto mb-7 flex w-fit animate-ks-fade items-center gap-3 rounded-full border border-cyan/30 bg-accent px-6 py-3",
        "text-base font-semibold text-accent-foreground backdrop-blur-md",
        className,
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={2} />
      <span className="text-pretty">{children}</span>
      {direction !== "none" && (
        <Arrow
          className={cn(
            "size-5 shrink-0",
            direction === "right" ? "animate-ks-nudge-x" : "animate-ks-nudge",
          )}
          strokeWidth={2.4}
          aria-hidden
        />
      )}
    </div>
  );
}
