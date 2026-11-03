// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Wallet } from "lucide-react";
import { useLiveRecord } from "@/hooks/use-live-record";
import { formatMoney, formatShortDate, kioskCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { outstandingBalance } from "@/hospital/records";
import { CtaButton } from "./cta-button";

/** After check-in, the bill still due: one tap to pay it while the patient waits, still signed in. Nothing when nothing is due. */
export function PayBalanceOffer({
  documentNumber,
  onPay,
  className,
}: {
  documentNumber: string;
  onPay: () => void;
  className?: string;
}) {
  const record = useLiveRecord(documentNumber);
  if (!record || record.invoices.length === 0) return null;
  const count = record.invoices.length;
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-4 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4 text-left",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
          <Wallet className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-xl font-semibold">{formatMoney(outstandingBalance(record), kioskCurrency())} still to pay</div>
          <p className="text-base text-pretty text-muted-foreground">
            {count} unpaid {count === 1 ? "bill" : "bills"} from {formatShortDate(record.invoices[0].date)} — pay here
            while you wait.
          </p>
        </div>
      </div>
      <CtaButton className="min-h-14 px-7 py-3 text-lg" onClick={onPay}>
        Pay now
      </CtaButton>
    </div>
  );
}
