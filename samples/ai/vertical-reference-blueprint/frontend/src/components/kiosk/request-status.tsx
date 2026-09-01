// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Badge } from "@/components/ui/badge";
import type { KioskRequestStatus } from "@/lib/api/kiosk";
import { cn } from "@/lib/utils";

const STATUS: Record<KioskRequestStatus, { label: string; className: string }> = {
  saved: { label: "Saved", className: "bg-primary/10 text-primary" },
  in_review: { label: "In Review", className: "bg-warning/10 text-warning" },
  officer_review: { label: "Officer Review", className: "bg-warning/10 text-warning" },
  on_hold: { label: "On Hold", className: "bg-destructive/10 text-destructive" },
};

/** Status chip for a saved draft or a submitted case, on receipts and lists. */
export function RequestStatusBadge({ status }: { status: KioskRequestStatus }) {
  const { label, className } = STATUS[status] ?? STATUS.in_review;
  return (
    <Badge className={cn("rounded-full px-4 py-1.5 text-base font-bold", className)}>
      {label}
    </Badge>
  );
}
