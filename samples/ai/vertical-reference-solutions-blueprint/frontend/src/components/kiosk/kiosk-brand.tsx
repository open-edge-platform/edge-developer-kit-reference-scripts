// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  onDark?: boolean;
  /** Gently bobs the logo tile — welcome screen only. */
  bobLogo?: boolean;
};

export function KioskBrand({ className, onDark = false, bobLogo = false }: Props) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div
        className={cn(
          "flex size-14 items-center justify-center rounded-2xl",
          bobLogo && "animate-ks-bob",
          onDark ? "border border-white/25 bg-white/15 backdrop-blur-sm" : "ks-gradient ks-glow",
        )}
      >
        <Hexagon className={cn("size-7", onDark ? "text-white" : "text-on-accent")} />
      </div>
      <div>
        <div className="font-heading text-xl font-bold tracking-tight">Public Service Kiosk</div>
        <div className={cn("text-sm font-medium", onDark ? "text-white/70" : "text-muted-foreground")}>
          Self-Service Terminal
        </div>
      </div>
    </div>
  );
}
