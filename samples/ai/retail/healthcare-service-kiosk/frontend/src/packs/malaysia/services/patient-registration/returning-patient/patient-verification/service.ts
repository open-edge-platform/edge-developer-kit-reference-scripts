// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "verify",
  label: "Patient Verification",
  description: "Confirm your patient record is still up to date",
  fee: 0,
  order: 1,
  icon: "user-check",
  repeatable: true,
  documents: [],
  fields: [
    { id: "detailsConfirmed", briefing: "whether the registered details are still correct: \"yes\" or \"update\"" },
    { id: "phone", briefing: "new phone number, only collected if updating" },
  ],
  briefingNotes: ["Ends with a queue number for the registration counter."],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Confirm details" },
};
