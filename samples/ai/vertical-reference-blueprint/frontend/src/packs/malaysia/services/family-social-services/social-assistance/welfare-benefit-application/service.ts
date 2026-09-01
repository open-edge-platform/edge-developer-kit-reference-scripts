// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "welfare",
  label: "Welfare Aid Application (Bantuan JKM)",
  description: "JKM · Monthly federal aid: BKK, BWE, BTB and EPOKU",
  fee: 0,
  documents: [
    PROOF_OF_IDENTITY,
    supportingDocument(
      "Income Proof",
      "Income proof; OKU card & medical report for OKU schemes",
      ["A payslip or other proof of income", "An OKU (disability) card", "A medical report"],
      { holderRole: "the employee or patient the document is about, never the employer or the clinic issuing it" },
    ),
  ],
  fields: [
    { id: "scheme", briefing: "the JKM aid scheme, offered from what the citizen's record qualifies for (\"bkk\", \"bwe\", \"btb\" or \"epoku\")" },
    { id: "income", briefing: "monthly household income in RM" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "Scheme" },
};
