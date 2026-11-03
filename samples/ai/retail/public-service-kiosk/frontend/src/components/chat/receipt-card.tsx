// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { FlowResponse } from "@/app/api/_lib/flows/types";
import { cn } from "@/lib/utils";

export function ReceiptCard({ flow }: { flow: FlowResponse }) {
  const receipt = flow.receipt!;
  return (
    <div className="max-w-[92%] rounded-3xl border bg-card p-5 text-base sm:max-w-[85%]">
      <Row label="Case ID" value={receipt.caseId} strong />
      <Row label="Service" value={flow.serviceLabel} />
      <Row
        label="Amount paid"
        value={
          receipt.payment
            ? `${receipt.payment.currency} ${receipt.payment.amount.toFixed(2)} (${receipt.payment.method})`
            : "No fee"
        }
      />
      <Row label="Status" value={receipt.status.replaceAll("_", " ")} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", strong && "font-bold text-primary")}>
        {value}
      </span>
    </div>
  );
}
