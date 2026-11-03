// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "feedback",
  label: "Patient Survey",
  description: "Rate your visit and leave feedback for the hospital",
  fee: 0,
  order: 1,
  icon: "star",
  documents: [],
  fields: [
    { id: "rating", briefing: "the patient's rating, 1 (very poor) to 5 (excellent)" },
    { id: "area", briefing: "\"Registration\", \"Clinic\", \"Pharmacy\", \"Billing\" or \"Facilities\"" },
    { id: "comment", briefing: "an optional free-text comment, or \"skip\" if the patient has none" },
  ],
  flow: ["application", "result"],
  stepLabels: { application: "Feedback" },
};
