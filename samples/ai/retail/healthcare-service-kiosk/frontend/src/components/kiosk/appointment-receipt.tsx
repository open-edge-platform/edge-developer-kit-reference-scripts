// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { formatDayParts } from "@/lib/format";
import type { StepProps } from "@/services/shared/step-props";
import { Receipt } from "@/services/shared/steps/receipt";
import { AppointmentSlip } from "./appointment-slip";

/** The booking services' receipt: the signed slip the patient scans on the day. */
export function AppointmentReceipt(props: StepProps) {
  const { data } = props.state;
  const day = data.slipCode && data.date && data.time ? formatDayParts(data.date) : null;
  const takeaway = day
    ? {
        title: `See you ${day.weekday} ${day.day} ${day.month} at ${data.time}`,
        detail:
          `Your visit with ${data.doctorName} is booked. Keep the slip — scan it at the kiosk on the day to check in.` +
          (data.confirmationSent ? ` We've sent ${data.confirmationSent} to confirm.` : ""),
        artifact: (
          <AppointmentSlip
            reference={props.state.application!.caseId}
            slipCode={data.slipCode}
            departmentId={data.department}
            doctor={data.doctorName}
            date={data.date}
            time={data.time}
          />
        ),
        printCode: data.slipCode,
      }
    : null;
  return <Receipt {...props} takeaway={takeaway} />;
}
