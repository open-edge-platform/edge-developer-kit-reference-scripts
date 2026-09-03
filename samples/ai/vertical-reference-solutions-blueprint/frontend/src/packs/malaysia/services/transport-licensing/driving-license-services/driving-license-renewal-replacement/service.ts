// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "dl_renew",
  label: "Driving License Renewal / Replacement",
  description: "JPJ · Renew your CDL (RM30/year) or replace a lost or damaged card (RM20)",
  fee: 30,
  // Renewal at RM30/year (class D) for the chosen duration; duplicate card RM20.
  pricing: {
    field: "priceKey",
    rates: { "1": 30, "2": 60, "3": 90, "5": 150, replace: 20 },
  },
  order: 2,
  documents: [
    PROOF_OF_IDENTITY,
    supportingDocument(
      "Existing Driving Licence or Police Report",
      "Existing license — police report optional for loss",
      ["The citizen's existing driving licence", "A police report for a lost or stolen licence"],
      { holderRole: "the licence holder — on a police report, the complainant (pengadu) who reported the loss, never the officer who recorded it" },
    ),
  ],
  fields: [
    { id: "licenseClass", briefing: "one of the citizen's renewable license classes on record (picked automatically when they hold exactly one)" },
    { id: "requestType", briefing: "\"renewal\" (extend validity) or \"replacement\" (lost or damaged card)" },
    { id: "duration", briefing: "renewal years, \"1\", \"2\", \"3\" or \"5\" (renewals only)" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "Request" },
};
