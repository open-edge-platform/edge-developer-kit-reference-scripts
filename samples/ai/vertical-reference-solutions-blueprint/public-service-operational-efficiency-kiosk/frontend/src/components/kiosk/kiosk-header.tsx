// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClock } from "@/hooks/use-clock";
import { formatTime } from "@/lib/format";
import { KioskBrand } from "./kiosk-brand";
import { ModeToggle } from "./mode-toggle";
import { ThemeToggle } from "./theme-toggle";

export function KioskHeader() {
  const now = useClock();

  return (
    <div className="flex items-center justify-between">
      <KioskBrand />
      <div className="flex items-center gap-4">
        <Badge
          variant="secondary"
          className="gap-2 rounded-full border bg-secondary px-5 py-2.5 text-base font-semibold text-ink"
        >
          <span className="size-2 rounded-full bg-success shadow-[0_0_10px_var(--color-success)]" />
          Secure
        </Badge>
        <Badge
          variant="secondary"
          className="gap-2 rounded-full border bg-secondary px-5 py-2.5 text-base font-semibold text-ink"
        >
          <Globe className="size-5 text-cyan" />
          EN
        </Badge>
        <ModeToggle className="flex size-11 items-center justify-center rounded-xl border bg-secondary transition-colors hover:bg-card" />
        <ThemeToggle className="flex size-11 items-center justify-center rounded-xl border bg-secondary transition-colors hover:bg-card" />
        <div className="font-heading text-lg font-semibold tabular-nums">{formatTime(now)}</div>
      </div>
    </div>
  );
}
