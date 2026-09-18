// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Green gradient tick marking a completed payment or submission. */
export function SuccessBadge({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex size-28 items-center justify-center", className)}>
      <div className="absolute inset-0 animate-ks-halo rounded-full border-2 border-success/50" />
      <div
        className="absolute inset-0 animate-ks-halo rounded-full border-2 border-cyan/40"
        style={{ animationDelay: "0.8s" }}
      />
      <div className="flex size-full animate-ks-pop items-center justify-center rounded-full bg-[image:var(--gradient-success)] shadow-[0_22px_60px_rgba(34,197,94,0.4)]">
        <Check
          className="size-14 animate-ks-draw text-white [stroke-dasharray:30] [stroke-dashoffset:30]"
          strokeWidth={2.4}
        />
      </div>
    </div>
  );
}
