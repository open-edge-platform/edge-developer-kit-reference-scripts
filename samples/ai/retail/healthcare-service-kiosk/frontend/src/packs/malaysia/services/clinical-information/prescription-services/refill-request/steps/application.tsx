// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Pill } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { TapCard } from "@/components/kiosk/tap-card";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { ListHeading } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { LoadingStep, StatusStep, StepShell } from "@/services/shared/step-shell";
import { useLiveRecord } from "@/hooks/use-live-record";
import { NONE_ELIGIBLE, refillOptions, refillPayer } from "../refill";

export default function RefillStep({ state, actions }: StepProps) {
  const documentNumber = state.identity!.documentNumber;
  const record = useLiveRecord(documentNumber);
  const currency = kioskCurrency();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!record) return <LoadingStep title="Request a refill" subtitle="Looking up your prescriptions…" />;
  const options = refillOptions(record);

  if (!options.some((o) => o.ok)) {
    return (
      <StatusStep
        title="Refill Request"
        icon={Pill}
        heading="No refills available"
        description={NONE_ELIGIBLE}
      />
    );
  }
  const ids = Array.from(selected).join(",");
  const covered = selected.size > 0 ? refillPayer(record, ids) : null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <StepShell title="Request a refill" subtitle="Choose the prescriptions you'd like refilled." className="max-w-3xl">
      <StepCard>
        <ListHeading>Your prescriptions</ListHeading>
        <div className="ks-stagger flex flex-col gap-3">
          {options.map(({ prescription: p, ok: canRefill, why }) => {
            return (
              <TapCard
                key={p.id}
                selected={canRefill && selected.has(p.id)}
                disabled={!canRefill}
                onClick={() => toggle(p.id)}
                className="flex items-center justify-between gap-4 p-5 text-left"
              >
                <div className="flex items-center gap-3">
                  <Pill className="size-6 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-lg font-semibold">{p.name}</div>
                    <div className="text-base text-muted-foreground">
                      {p.dosage} · {formatMoney(p.price, currency)}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right text-base font-medium text-muted-foreground">
                  {p.lastFilled === null
                    ? "New today — ready to collect"
                    : canRefill
                      ? `${p.refillsLeft} ${p.refillsLeft === 1 ? "refill" : "refills"} left`
                      : why}
                </div>
              </TapCard>
            );
          })}
        </div>
        {covered && (
          <p className="mt-4 text-base text-muted-foreground">
            Billed to {covered.name}, your insurer on file — nothing to pay at the kiosk.
          </p>
        )}
        <StepActions
          ready={selected.size > 0}
          idleLabel="Select a prescription to refill"
          label="Continue"
          onContinue={() =>
            actions.stepCompleted("application", {
              refillIds: ids,
              patientRef: documentNumber,
              ...(covered ? { coveredBy: covered.name } : {}),
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}
