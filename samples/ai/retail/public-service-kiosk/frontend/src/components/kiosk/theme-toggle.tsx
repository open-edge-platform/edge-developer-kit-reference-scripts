// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Renders "Dark" / "Light" next to the icon (welcome + chat pills). */
  showLabel?: boolean;
};

/** Sun/moon dark-mode switch; caller supplies the pill or tile chrome. */
export function ThemeToggle({ className, showLabel = false }: Props) {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn("cursor-pointer", className)}
    >
      {dark ? (
        <Sun className="size-5 text-warning" strokeWidth={1.8} />
      ) : (
        <Moon className="size-5 text-violet" strokeWidth={1.8} />
      )}
      {showLabel && (dark ? "Light" : "Dark")}
    </button>
  );
}
