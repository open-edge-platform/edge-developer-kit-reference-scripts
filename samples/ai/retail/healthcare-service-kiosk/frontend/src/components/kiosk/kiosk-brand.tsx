// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  onDark?: boolean;
  /** Gently bobs the logo tile — welcome screen only. */
  bobLogo?: boolean;
};

export function KioskBrand({ className, onDark = false, bobLogo = false }: Props) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3.5", className)}>
      <div
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-2xl",
          bobLogo && "animate-ks-bob",
          onDark ? "border border-white/25 bg-white/15 backdrop-blur-sm" : "ks-gradient",
        )}
      >
        <HeartPulse className={cn("size-7", onDark ? "text-white" : "text-on-accent")} />
      </div>
      <div>
        <div className="font-heading text-lg font-semibold tracking-tight sm:text-xl">Hospital Concierge</div>
        <div className={cn("mt-0.5 text-sm font-medium tracking-wide", onDark ? "text-white/70" : "text-muted-foreground")}>
          PATIENT SELF-SERVICE
        </div>
      </div>
    </div>
  );
}
