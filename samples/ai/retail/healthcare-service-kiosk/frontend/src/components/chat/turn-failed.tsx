// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TurnFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex animate-ks-fade flex-col gap-3 rounded-3xl border border-destructive/40 bg-destructive/10 p-5 text-left">
      <div className="flex items-start gap-2.5 text-base font-medium text-destructive">
        <CircleAlert className="mt-0.5 size-5 shrink-0" />
        <span className="text-pretty">
          The kiosk hit a problem and didn&apos;t finish answering. Nothing you did was lost —
          tap Try again to continue, or ask a staff member if this keeps happening.
        </span>
      </div>
      <Button
        variant="outline"
        className="h-14 self-start rounded-2xl px-6 text-lg font-semibold"
        onClick={onRetry}
      >
        <RotateCcw className="size-5" />
        Try again
      </Button>
    </div>
  );
}
