// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "refill",
  label: "Refill Request",
  description: "Collect the medicine from today's visit, or refill an eligible prescription",
  fee: 0,
  order: 2,
  icon: "pill-bottle",
  repeatable: true,
  variableFee: true,
  kioskFee: false,
  documents: [],
  fields: [
    {
      id: "refillIds",
      briefing: "which prescription(s) to collect or refill — comma-separated prescription ids, or all eligible ids joined by comma",
    },
  ],
  briefingNotes: [
    "Medicine the doctor prescribed at a visit the patient checked in for today is ready to collect here at once.",
    "A prescription can be refilled once three quarters of the last supply is used and while refills are left.",
    "Payment is only asked when no insurer on file covers the refill.",
  ],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Refill", payment: "Payment" },
};
