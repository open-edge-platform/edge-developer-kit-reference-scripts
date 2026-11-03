// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Pill } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { formatMoney, formatShortDate, kioskCurrency } from "@/lib/format";
import { ListHeading } from "@/services/shared/fields";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { LoadingStep, StatusStep, StepShell } from "@/services/shared/step-shell";
import { useLiveRecord } from "@/hooks/use-live-record";
import { prescriptionsResult } from "../prescriptions";

export default function PrescriptionsStep({ state, actions }: StepProps) {
  const documentNumber = state.identity!.documentNumber;
  const record = useLiveRecord(documentNumber);
  const currency = kioskCurrency();

  if (!record) return <LoadingStep title="Your prescriptions" subtitle="Looking up your record…" />;

  if (record.prescriptions.length === 0) {
    return (
      <StatusStep
        title="Prescriptions"
        icon={Pill}
        heading="No active prescriptions"
        description="You have no active prescriptions on record."
      />
    );
  }

  return (
    <StepShell title="Your prescriptions" subtitle="Current medications on your record." className="max-w-3xl">
      <StepCard>
        <ListHeading>Prescriptions</ListHeading>
        {record.prescriptions.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-4 border-b py-4 text-lg">
            <div>
              <div className="font-semibold">{p.name}</div>
              <div className="text-base text-muted-foreground">
                {p.dosage} · {p.durationDays} days ·{" "}
                {p.lastFilled === null ? "New today — ready to collect" : `Last filled ${formatShortDate(p.lastFilled)}`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{formatMoney(p.price, currency)}</div>
              <div className="text-base text-muted-foreground">
                {p.refillsLeft} {p.refillsLeft === 1 ? "refill" : "refills"} left
              </div>
            </div>
          </div>
        ))}
        <StepActions
          ready
          label="Continue"
          onContinue={() =>
            actions.stepCompleted(
              "application",
              resultData(prescriptionsResult(record, (amount) => formatMoney(amount, currency))),
            )
          }
        />
      </StepCard>
    </StepShell>
  );
}
