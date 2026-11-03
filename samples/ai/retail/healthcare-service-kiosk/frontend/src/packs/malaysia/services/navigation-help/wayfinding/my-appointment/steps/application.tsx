// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { CalendarX, Ticket } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { AppointmentCard } from "@/components/kiosk/appointment-card";
import { Notice } from "@/components/kiosk/notice";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { LoadFailed } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { useAppointmentsToday, useService } from "@/hooks/use-kiosk-api";
import type { StepProps } from "@/services/shared/step-props";
import { StatusStep, StepShell } from "@/services/shared/step-shell";
import { NO_APPOINTMENT } from "../visit";

/** Today's visit, then straight onto Indoor Navigation's route to that doctor's clinic. Keep in sync with chain.ts. */
export default function AppointmentStep({ state, actions }: StepProps) {
  const today = useAppointmentsToday(state.identity!.documentNumber);
  const directions = useService("directions");
  const checkin = useService("checkin");
  const [reference, setReference] = useState(state.data.appointmentReference ?? "");

  if (today.isPending) return <Spinner className="size-12 text-primary" />;
  if (today.isError) {
    return <LoadFailed message="Could not load today's appointments" onRetry={() => today.refetch()} />;
  }

  const { appointments, checkIns } = today.data;
  if (appointments.length === 0) {
    return <StatusStep title="Way to My Appointment" icon={CalendarX} heading="No appointment today" description={NO_APPOINTMENT} />;
  }
  const chosen =
    appointments.find((a) => a.reference === reference) ?? (appointments.length === 1 ? appointments[0] : undefined);
  const checkedIn = chosen && checkIns.find((c) => c.appointmentReference === chosen.reference);

  return (
    <StepShell
      title="Your appointment today"
      subtitle={appointments.length > 1 ? "Choose the visit you're going to." : "We'll show you the way to your doctor's clinic."}
      className="max-w-5xl"
    >
      {/* Side by side on a wide screen, so the way on stays in view beside the visit. */}
      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        <div className="flex flex-col gap-4">
          {appointments.map((appt) => (
            <AppointmentCard
              key={appt.reference}
              appointment={appt}
              selected={chosen?.reference === appt.reference}
              selectable={appointments.length > 1}
              onSelect={() => setReference(appt.reference)}
            />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {chosen &&
            (checkedIn ? (
              <Notice icon={Ticket}>You’re checked in — your queue number is {checkedIn.queueNumber}.</Notice>
            ) : (
              <Notice icon={Ticket}>
                You haven’t checked in yet — check in here first so the clinic knows you’ve arrived.
                {checkin && (
                  <div className="mt-3">
                    <SecondaryButton onClick={() => actions.startService(checkin, { appointmentReference: chosen.reference })}>
                      Check in first
                    </SecondaryButton>
                  </div>
                )}
              </Notice>
            ))}
          <StepActions
            ready={Boolean(chosen && directions)}
            idleLabel="Choose your appointment"
            label="Show me the way"
            onContinue={() => actions.startService(directions!, { destination: chosen!.department, stepFree: "no" }, "result")}
          />
        </div>
      </div>
    </StepShell>
  );
}
