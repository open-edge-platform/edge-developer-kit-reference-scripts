// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "birth",
  label: "Birth Registration (NRD.LM01)",
  description: "JPN · Free within 60 days; late registration RM50 (Peninsular)",
  fee: 0,
  pricing: { field: "timing", rates: { normal: 0, late: 50 } },
  documents: [
    PROOF_OF_IDENTITY,
    supportingDocument(
      "Hospital Birth Confirmation",
      "Hospital birth confirmation & parents' marriage certificate",
      ["A hospital birth confirmation for the child", "The parents' marriage certificate"],
      { holderRole: "the parent registering the birth — the mother or father named on the document, never the newborn, who has no IC number yet" },
    ),
  ],
  fields: [
    { id: "childName", briefing: "the child's full name as on the hospital birth confirmation" },
    { id: "childDob", briefing: "the child's date of birth" },
    { id: "birthPlace", briefing: "where the child was born (hospital or address)" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "Child" },
};
