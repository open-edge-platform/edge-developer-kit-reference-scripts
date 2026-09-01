// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "dl_new",
  label: "New Driving License Application",
  description: "JPJ · Apply for your first license after passing the KPP tests",
  // PDL (2-year probationary) fee by class; B2 uses the reduced MADANI rate.
  fee: 60,
  pricing: { field: "licenseClass", rates: { B2: 2, D: 60, DA: 60 } },
  order: 1,
  documents: [
    PROOF_OF_IDENTITY,
    supportingDocument(
      "KPP Test Result Slip",
      "KPP01 theory slip & JPJ02/03 practical test pass",
      ["A KPP01 computerised theory test result slip", "A JPJ02 or JPJ03 practical test pass slip"],
    ),
  ],
  fields: [
    { id: "licenseClass", briefing: "\"B2\" (motorcycle), \"D\" (car, manual) or \"DA\" (car, automatic), subject to age and classes already held" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "License Class" },
};
