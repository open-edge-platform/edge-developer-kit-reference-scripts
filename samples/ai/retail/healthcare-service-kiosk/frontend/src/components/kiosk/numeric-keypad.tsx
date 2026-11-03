// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

/** Big-target digit pad: the kiosk has no keyboard, and the OS one covers half the screen. */
export function NumericKeypad({
  onDigit,
  onBack,
  onClear,
  disabled,
  compact,
  className,
}: {
  onDigit: (digit: string) => void;
  onBack: () => void;
  onClear: () => void;
  disabled?: boolean;
  /** Shorter keys, for a pad that shares the screen with other ways in. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3", compact ? "gap-2" : "gap-3", className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-label={key === "back" ? "Delete last digit" : key === "clear" ? "Clear" : key}
          onClick={() => (key === "back" ? onBack() : key === "clear" ? onClear() : onDigit(key))}
          className={cn(
            "flex cursor-pointer items-center justify-center rounded-2xl border bg-card font-semibold tabular-nums shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
            compact ? "h-13 text-2xl" : "h-18 text-3xl",
            (key === "back" || key === "clear") && "bg-secondary text-lg text-secondary-foreground",
          )}
        >
          {key === "back" ? <Delete className="size-7" /> : key === "clear" ? "Clear" : key}
        </button>
      ))}
    </div>
  );
}
