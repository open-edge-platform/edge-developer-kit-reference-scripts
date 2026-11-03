// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { SlotPicker, slotLabel } from "@/components/kiosk/slot-picker";
import { StepCard } from "@/components/kiosk/step-card";
import { useTakenSlots } from "@/hooks/use-kiosk-api";
import type { StepProps } from "@/services/shared/step-props";
import { LoadingStep, StatusStep, StepShell } from "@/services/shared/step-shell";
import { department } from "@/hospital/data";
import { useLiveRecord } from "@/hooks/use-live-record";
import { formatShortDate } from "@/lib/format";
import { followUpDoctor, followUpSlots } from "../followup";

export default function FollowUpStep({ state, actions }: StepProps) {
  const documentNumber = state.identity!.documentNumber;
  const record = useLiveRecord(documentNumber);
  const followUp = record?.followUp ?? null;
  const doctor = record && followUp ? followUpDoctor(record) : undefined;
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const taken = new Set(useTakenSlots(doctor?.id).data?.taken ?? []);

  if (!record) return <LoadingStep title="Book your follow-up visit" subtitle="Looking up your record…" />;

  if (followUp?.booked) {
    return (
      <StatusStep
        title="Follow-up Visit"
        icon={CalendarClock}
        heading="Your follow-up is booked"
        description={`With ${followUp.booked.doctorName} on ${formatShortDate(followUp.booked.date)} at ${followUp.booked.time} (reference ${followUp.booked.caseId}). To change it, please see the registration counter.`}
      />
    );
  }

  if (!followUp || !doctor) {
    return (
      <StatusStep
        title="Follow-up Visit"
        icon={CalendarClock}
        heading="No follow-up recommended"
        description="There is no follow-up recommended on your record. To see a specialist, use New Specialist Visit."
      />
    );
  }

  const slots = followUpSlots(record, 4).filter((s) => !taken.has(`${s.date} ${s.time}`));

  return (
    <StepShell
      title="Book your follow-up visit"
      subtitle={`${doctor.name} recommended a follow-up in ${followUp.inWeeks} weeks in ${department(followUp.department)!.name}.`}
      className="max-w-3xl"
    >
      <StepCard>
        <SlotPicker slots={slots} date={date} time={time} onDate={setDate} onTime={setTime} />
        <StepActions
          ready={Boolean(date && time)}
          label={date && time ? `Book ${slotLabel(date, time)}` : undefined}
          idleLabel="Choose a day and time to continue"
          onContinue={() => {
            actions.stepCompleted("application", {
              department: followUp.department,
              doctorId: doctor.id,
              doctorName: followUp.doctor,
              date,
              time,
            });
          }}
        />
      </StepCard>
    </StepShell>
  );
}
