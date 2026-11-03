// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "insurance",
  label: "Eligibility Check",
  description: "Scan your insurance card and check it is ready for a Guarantee Letter request",
  fee: 0,
  order: 1,
  icon: "shield-check",
  // Captured inside the application step, not a documents step: a patient without the card still has a path.
  documents: [
    {
      id: "insurance-card",
      label: "Insurance Card",
      hint: "your insurance or TPA medical card — optional, you can choose your insurer instead",
      accepts: ["A medical insurance or takaful card", "A TPA medical card (such as MiCare or PMCare)"],
      holderDetails: ["name"],
      holderRole: "the insured member named on the card",
    },
  ],
  fields: [
    { id: "cardChoice", briefing: "\"scan\" to read the patient's insurance card, or \"manual\" when it isn't with them" },
    {
      id: "payerId",
      briefing: "the patient's insurer from the panel list — asked only without a card, or when the card doesn't show it",
    },
  ],
  briefingNotes: [
    "No insurer approves anything at the kiosk: the outcome is only whether the card is ready for a Guarantee Letter request or needs the Billing & Insurance Counter.",
  ],
  flow: ["consent", "identity", "application", "result"],
  stepLabels: { application: "Card" },
};
