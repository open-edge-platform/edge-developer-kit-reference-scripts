// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createElement } from "react";
import type { FlowResponse } from "@/app/api/_lib/flows/types";
import { packTakeaway } from "@/packs/malaysia/steps";
import { getService } from "@/services";
import { cn } from "@/lib/utils";

export function ReceiptCard({ flow }: { flow: FlowResponse }) {
  const receipt = flow.receipt!;
  const dir = getService(flow.serviceId)?.dir;
  const Takeaway = dir && receipt.status !== "on_hold" ? packTakeaway(dir) : undefined;
  return (
    <div className="flex max-w-[92%] flex-col gap-3 sm:max-w-[85%]">
      <div className="rounded-3xl border bg-card p-5 text-base">
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
      {/* Resolved per service, like a step: createElement keeps its identity across renders. */}
      {Takeaway &&
        createElement(Takeaway, {
          caseId: receipt.caseId,
          status: receipt.status,
          data: receipt.takeaway ?? {},
          name: flow.citizen?.name ?? "",
          documentNumber: flow.citizen?.documentNumber ?? "",
        })}
    </div>
  );
}

/** A finished look-up — a price, a medication list, results — as the flow worded it, so nothing rests on the reply alone. */
export function ResultCard({ flow }: { flow: FlowResponse }) {
  const dir = getService(flow.serviceId)?.dir;
  const Takeaway = dir ? packTakeaway(dir) : undefined;
  return (
    <div className="flex max-w-[92%] flex-col items-start gap-3 sm:max-w-[85%]">
      <div className="w-full rounded-3xl border bg-card p-5" data-print>
        <div className="mb-2 text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {flow.serviceLabel}
        </div>
        <div className="text-base leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{flow.say}</div>
      </div>
      {Takeaway &&
        createElement(Takeaway, {
          caseId: "",
          status: "",
          data: {},
          name: flow.citizen?.name ?? "",
          documentNumber: flow.citizen?.documentNumber ?? "",
        })}
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
