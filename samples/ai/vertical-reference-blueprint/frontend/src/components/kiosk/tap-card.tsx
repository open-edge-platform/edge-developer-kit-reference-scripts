// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<"button"> & {
  /**
   * Raises and tints the card to mark it as the current choice. Leave it
   * undefined on cards that navigate rather than toggle — `aria-pressed` is
   * only announced when the card genuinely represents a selection.
   */
  selected?: boolean;
};

/** Large touch-target card button shared by every selectable kiosk tile. */
export function TapCard({ className, selected, ...props }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "ks-rest cursor-pointer rounded-3xl border bg-card text-left text-card-foreground backdrop-blur-md outline-none",
        "transition-[transform,background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
        "hover:ks-lift hover:-translate-y-1.25",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-60",
        selected && "ks-lift -translate-y-1 border-2 border-ring bg-selected",
        className,
      )}
      {...props}
    />
  );
}
