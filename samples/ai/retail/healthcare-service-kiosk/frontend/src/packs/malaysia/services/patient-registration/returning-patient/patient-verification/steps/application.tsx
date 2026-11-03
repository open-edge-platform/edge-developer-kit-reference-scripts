// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { CalendarClock, CreditCard, IdCard, ShieldAlert } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { maskId } from "@/lib/mask";
import { ListHeading, OptionCards, SectionLabel, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { LoadingStep, StepShell } from "@/services/shared/step-shell";
import { displayMrn } from "@/hospital/patient-id";
import { useLiveRecord } from "@/hooks/use-live-record";
import { statusNotes } from "../status";

export default function ConfirmDetailsStep({ state, actions }: StepProps) {
  const profile = state.profile!;
  const documentNumber = state.identity!.documentNumber;
  const record = useLiveRecord(documentNumber);
  const currency = kioskCurrency();

  const [detailsConfirmed, setDetailsConfirmed] = useState(state.data.detailsConfirmed ?? "");
  const [phone, setPhone] = useState(state.data.phone || profile.phone);

  if (!record) return <LoadingStep title="Are your details still correct?" subtitle="Looking up your record…" />;
  const notes = statusNotes(record, (amount) => formatMoney(amount, currency));

  const updating = detailsConfirmed === "update";
  const ready = Boolean(detailsConfirmed) && (!updating || phone.trim().length > 0);

  return (
    <StepShell title="Are your details still correct?" subtitle="A quick check before your visit." className="max-w-3xl">
      <StepCard>
        <ListHeading>Your record</ListHeading>
        <Row label="MRN" value={displayMrn(record.mrn)} />
        <Row label="Name" value={profile.name} />
        <Row label={profile.country === "Malaysia" ? "IC number" : "Passport"} value={maskId(profile.nationalId)} />
        <Row label="Date of birth" value={profile.dateOfBirth} />
        <Row label="Phone" value={profile.phone} />
        <Row label="Address" value={profile.address} />

        <ListHeading className="mt-6">Your status today</ListHeading>
        <div className="flex flex-col gap-3">
          {notes.map((note) => (
            <Notice
              key={note}
              tone={/expired|Outstanding/.test(note) ? "warning" : undefined}
              icon={/appointment/.test(note) ? CalendarClock : /Outstanding/.test(note) ? CreditCard : ShieldAlert}
            >
              {note}
            </Notice>
          ))}
        </div>

        <SectionLabel>Still correct?</SectionLabel>
        <OptionCards
          options={[
            { id: "yes", label: "Yes, still correct", icon: IdCard },
            { id: "update", label: "No, update my phone", icon: CreditCard },
          ]}
          value={detailsConfirmed}
          onSelect={(value) => setDetailsConfirmed(value)}
          columns={2}
        />

        {updating && (
          <div className="mt-5">
            <TextField id="phone" label="New phone number" value={phone} onChange={setPhone} placeholder="012-3456789" />
          </div>
        )}

        <StepActions
          ready={ready}
          idleLabel="Confirm your details to continue"
          onContinue={() =>
            actions.stepCompleted("application", {
              detailsConfirmed,
              phone: updating ? phone : profile.phone,
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-4 text-lg">
      <span className="text-base text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
