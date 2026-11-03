// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Clock, Ticket } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { AppointmentCard } from "@/components/kiosk/appointment-card";
import { Notice } from "@/components/kiosk/notice";
import { LoadFailed } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { useAppointmentsToday, useService } from "@/hooks/use-kiosk-api";
import { cn } from "@/lib/utils";
import type { StepProps } from "@/services/shared/step-props";
import { StatusStep, StepShell } from "@/services/shared/step-shell";
import { department } from "@/hospital/data";
import { arrivalFor, arrivalNote, PRE_VISIT_QUESTIONS, YES_NO } from "../checkin";
import { QueueTicket } from "@/components/queue/queue-ticket";

export default function CheckInStep({ state, actions }: StepProps) {
  const documentNumber = state.identity!.documentNumber;
  const today = useAppointmentsToday(documentNumber);
  const directions = useService("directions");
  const [reference, setReference] = useState(state.data.appointmentReference ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({
    medsChanged: state.data.medsChanged ?? "",
    infection: state.data.infection ?? "",
  });

  if (today.isPending) return <Spinner className="size-12 text-primary" />;
  if (today.isError) {
    return <LoadFailed message="Could not load today's appointments" onRetry={() => today.refetch()} />;
  }

  const { checkIns } = today.data;
  // One check-in per appointment: a visit already checked in drops out of the list.
  const appointments = today.data.appointments.filter(
    (a) => !checkIns.some((c) => c.appointmentReference === a.reference),
  );
  const checkedIn = checkIns.at(-1);
  if (checkedIn && appointments.length === 0) {
    const visit = today.data.appointments.find((a) => a.reference === checkedIn.appointmentReference);
    return (
      <StepShell title="You're already checked in" subtitle="Your number is still the one below — there's no need to check in again." className="max-w-3xl">
        <QueueTicket
          queueNumber={checkedIn.queueNumber}
          departmentId={checkedIn.department}
          doctor={visit?.doctor}
          time={visit?.time}
          onRoute={
            directions
              ? () => actions.startService(directions, { destination: checkedIn.department, stepFree: "no" }, "result")
              : undefined
          }
        />
      </StepShell>
    );
  }
  if (appointments.length === 0) {
    return (
      <StatusStep
        title="Same-Day Check-In"
        icon={Ticket}
        heading="No appointment today"
        description="We can't find an appointment for you today. To see a doctor, use New Specialist Visit, or ask at the registration counter."
      />
    );
  }

  const chosen =
    appointments.find((a) => a.reference === reference) ?? (appointments.length === 1 ? appointments[0] : undefined);
  const ready = Boolean(chosen) && PRE_VISIT_QUESTIONS.every((q) => answers[q.id]);
  const note = chosen ? arrivalNote(chosen.time) : null;

  return (
    <StepShell title="Check in for your appointment" subtitle="Confirm your visit and answer two quick questions for the clinic." className="max-w-5xl">
      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col gap-4">
          {checkedIn && (
            <Notice icon={Ticket}>
              Already checked in for {department(checkedIn.department)?.name ?? checkedIn.department} — your number is{" "}
              {checkedIn.queueNumber}. Check in for your other visit below.
            </Notice>
          )}
          {appointments.map((appt) => (
            <AppointmentCard
              key={appt.reference}
              appointment={appt}
              selected={chosen?.reference === appt.reference}
              selectable={appointments.length > 1}
              onSelect={() => setReference(appt.reference)}
            />
          ))}
          {note && (
            <Notice icon={Clock} tone={chosen && arrivalFor(chosen.time).arrival === "late" ? "warning" : undefined}>
              {note}
            </Notice>
          )}
        </div>

        <StepCard className="flex flex-col">
          <div className="mb-1 text-base font-bold tracking-[0.1em] text-muted-foreground/80 uppercase">Before you check in</div>
          {PRE_VISIT_QUESTIONS.map((q) => (
            <div key={q.id} className="border-b py-5 last:border-b-0">
              <p className="text-xl font-semibold text-pretty">{q.question}</p>
              <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label={q.question}>
                {YES_NO.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={answers[q.id] === option.value}
                    onClick={() => setAnswers((current) => ({ ...current, [q.id]: option.value }))}
                    className={cn(
                      "h-16 cursor-pointer rounded-2xl border-2 text-xl font-semibold transition active:scale-[0.98]",
                      answers[q.id] === option.value
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="mt-2 text-base text-muted-foreground">Your answers go to the clinic team only.</p>
          <div className="mt-auto">
            <StepActions
              ready={ready}
              idleLabel={chosen ? "Answer both questions to check in" : "Choose your appointment"}
              label="Check in"
              onContinue={() =>
                actions.stepCompleted("application", {
                  appointmentReference: chosen!.reference,
                  department: chosen!.department,
                  doctor: chosen!.doctor,
                  time: chosen!.time,
                  arrival: arrivalFor(chosen!.time).arrival,
                  ...answers,
                })
              }
            />
          </div>
        </StepCard>
      </div>
    </StepShell>
  );
}
