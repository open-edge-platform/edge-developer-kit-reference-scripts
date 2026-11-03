// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { SlotPicker, slotLabel } from "@/components/kiosk/slot-picker";
import { StepCard } from "@/components/kiosk/step-card";
import { useTakenSlots } from "@/hooks/use-kiosk-api";
import { OptionCards, SectionLabel } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { DOCTORS, SPECIALIST_DEPARTMENTS, department } from "@/hospital/data";
import { bookableSlots } from "@/hospital/records";

export default function AppointmentStep({ state, actions }: StepProps) {
  const [dept, setDept] = useState(state.data.department ?? "");
  const [doctorId, setDoctorId] = useState(state.data.doctorId ?? "");
  const [date, setDate] = useState(() => keptSlot(state.data).date);
  const [time, setTime] = useState(() => keptSlot(state.data).time);

  const doctors = DOCTORS.filter((d) => d.department === dept);
  const doctor = doctors.find((d) => d.id === doctorId);
  const taken = new Set(useTakenSlots(doctor?.id).data?.taken ?? []);
  const slots = doctor ? bookableSlots(doctor).filter((s) => !taken.has(`${s.date} ${s.time}`)) : [];

  return (
    <StepShell title="Book a specialist visit" subtitle="Choose a department, doctor and time." className="max-w-4xl">
      <StepCard>
        <SectionLabel className="mt-0">Department</SectionLabel>
        <OptionCards
          options={SPECIALIST_DEPARTMENTS.map((id) => ({ id, label: department(id)!.name, icon: Stethoscope }))}
          value={dept}
          onSelect={(value) => {
            setDept(value);
            setDoctorId("");
            setDate("");
            setTime("");
          }}
          columns={3}
        />

        {dept && (
          <>
            <SectionLabel>Doctor</SectionLabel>
            <OptionCards
              options={doctors.map((d) => ({
                id: d.id,
                label: d.name,
                hint: `${d.languages.join(", ")} · ${d.days.join(", ")}`,
              }))}
              value={doctorId}
              onSelect={(value) => {
                setDoctorId(value);
                setDate("");
                setTime("");
              }}
              columns={2}
              prompt="Choose a doctor"
            />
          </>
        )}

        {doctor && (
          <>
            <SectionLabel>Day and time</SectionLabel>
            <SlotPicker slots={slots} date={date} time={time} onDate={setDate} onTime={setTime} />
          </>
        )}

        <StepActions
          ready={Boolean(doctor && date && time)}
          label={date && time ? `Book ${slotLabel(date, time)}` : undefined}
          idleLabel="Choose a department, doctor and time to continue"
          onContinue={() => {
            actions.stepCompleted("application", {
              department: dept,
              doctorId,
              doctorName: doctor?.name ?? "",
              date,
              time,
            });
          }}
        />
      </StepCard>
    </StepShell>
  );
}

/** A slot picked before this step (Find a Doctor, a resumed draft), while the doctor still offers it. */
function keptSlot(data: Record<string, string>): { date: string; time: string } {
  const doctor = DOCTORS.find((d) => d.id === data.doctorId && d.department === data.department);
  const offered = doctor && bookableSlots(doctor).some((s) => s.date === data.date && s.time === data.time);
  return offered ? { date: data.date, time: data.time } : { date: "", time: "" };
}
