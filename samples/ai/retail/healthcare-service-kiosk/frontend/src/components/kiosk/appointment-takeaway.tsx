// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { TakeawayProps } from "@/packs/malaysia/steps";
import { AppointmentSlip } from "./appointment-slip";
import { PrintButton } from "./print-button";

/** The booking services' takeaway in chat: the same signed slip the touch receipt shows, and a Print for the paper one. */
export function AppointmentTakeaway({ caseId, data }: TakeawayProps) {
  if (!data.slipCode || !data.date || !data.time) return null;
  return (
    <>
      <AppointmentSlip
        reference={caseId}
        slipCode={data.slipCode}
        departmentId={data.department}
        doctor={data.doctorName}
        date={data.date}
        time={data.time}
      />
      <PrintButton code={data.slipCode} label="Print my slip" />
    </>
  );
}
