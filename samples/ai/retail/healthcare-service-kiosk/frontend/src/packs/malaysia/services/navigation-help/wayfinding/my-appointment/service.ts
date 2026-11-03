// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "myappointment",
  label: "Way to My Appointment",
  description: "Take me to my appointment or my doctor today — finds today's booking and shows the way to the clinic",
  fee: 0,
  order: 2,
  icon: "navigation",
  documents: [],
  fields: [
    {
      id: "appointmentReference",
      briefing: "which of today's appointments to go to, one of the references the flow lists (picked automatically when the patient has only one today)",
    },
  ],
  briefingNotes: [
    "Use this, not directions, for the way to the patient's own appointment, booking or doctor today: it looks up who they are seeing and where. It shows the way only — checking in is checkin.",
  ],
  flow: ["consent", "identity", "application"],
  stepLabels: { application: "Your appointment" },
};
