// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "followup",
  label: "Follow-up Visit",
  description: "Book the follow-up visit your doctor recommended",
  fee: 0,
  order: 2,
  icon: "calendar-check",
  documents: [],
  fields: [
    { id: "preferredDate", ahead: true, briefing: "the day the patient asked for, as YYYY-MM-DD from the calendar" },
    {
      id: "preferredTime",
      ahead: true,
      briefing: "the time the patient asked for, as 24-hour HH:MM — if free, the patient is asked to confirm it (nothing is booked until they say yes), else the closest free times are offered",
    },
    { id: "slot", briefing: "which appointment slot for the recommended follow-up, chosen from the available slots" },
    { id: "confirmBooking", briefing: '"yes" to book the chosen slot, "change" to pick another time' },
  ],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Appointment" },
};
