// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Siren } from "lucide-react";
import { EMERGENCY_DIRECTIONS } from "@/hospital/data";
import { cn } from "@/lib/utils";

/** Red-flag symptoms should never wait in a self-service queue. */
export function EmergencyBanner({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-center gap-4 rounded-2xl border border-destructive/25 bg-destructive/10 px-5 py-4 text-destructive",
        className,
      )}
    >
      <Siren className="size-7 shrink-0" aria-hidden />
      <p className="text-lg leading-snug">
        <strong className="font-semibold">Chest pain, trouble breathing or heavy bleeding?</strong>{" "}
        Don&apos;t wait at the kiosk. {EMERGENCY_DIRECTIONS}
      </p>
    </div>
  );
}
