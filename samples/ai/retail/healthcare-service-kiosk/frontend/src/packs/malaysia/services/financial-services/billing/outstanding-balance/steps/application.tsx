// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { CircleCheck } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { ListHeading } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { LoadingStep, StatusStep, StepShell } from "@/services/shared/step-shell";
import { useLiveRecord } from "@/hooks/use-live-record";
import { outstandingBalance } from "@/hospital/records";

export default function InvoicesStep({ state, actions }: StepProps) {
  const documentNumber = state.identity!.documentNumber;
  const record = useLiveRecord(documentNumber);
  const currency = kioskCurrency();

  if (!record) return <LoadingStep title="Your invoices" subtitle="Looking up your invoices…" />;

  if (record.invoices.length === 0) {
    return (
      <StatusStep
        title="Outstanding Balance"
        icon={CircleCheck}
        heading="Nothing to pay"
        description="You have no outstanding invoices with the hospital."
      />
    );
  }

  return (
    <StepShell title="Your invoices" subtitle="These invoices are still unpaid." className="max-w-3xl">
      <StepCard>
        <ListHeading>Unpaid invoices</ListHeading>
        {record.invoices.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-4 border-b py-4 text-lg">
            <div>
              <div className="font-semibold">{inv.description}</div>
              <div className="text-base text-muted-foreground">
                {inv.id} · {inv.date}
              </div>
            </div>
            <div className="font-semibold">{formatMoney(inv.amount, currency)}</div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-4 text-xl font-bold">
          <span>Total</span>
          <span>{formatMoney(outstandingBalance(record), currency)}</span>
        </div>
        <StepActions
          ready
          label="Pay now"
          onContinue={() =>
            actions.stepCompleted("application", {
              patientRef: documentNumber,
              invoiceIds: record.invoices.map((inv) => inv.id).join(","),
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}
