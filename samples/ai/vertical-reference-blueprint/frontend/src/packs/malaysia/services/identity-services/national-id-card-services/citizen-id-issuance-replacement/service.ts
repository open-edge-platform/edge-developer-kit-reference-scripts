// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "idcard",
  label: "MyKad Issuance / Replacement",
  description: "JPN · First MyKad at 12, lost/damaged replacement, particulars change",
  fee: 10,
  // Lost-card tiers include the RM10 application fee (RM100/300/1,000 + RM10).
  pricing: {
    field: "priceKey",
    rates: { first: 0, lost1: 110, lost2: 310, lost3: 1010, damaged: 10, update: 20 },
  },
  documents: [
    PROOF_OF_IDENTITY,
    supportingDocument(
      "Police Report, Birth Certificate or Old MyKad",
      "Birth certificate (first card), police report (loss) or old card",
      [
        "A police report for a lost or stolen MyKad",
        "A birth certificate (for a first MyKad)",
        "The old or damaged MyKad",
      ],
      {
        holderRole:
          "the person the card is for — on a police report the complainant (pengadu) who " +
          "reported the loss, never the officer who recorded it; on a birth certificate the " +
          "child it was issued for, not the parents named on it",
      },
    ),
  ],
  fields: [
    { id: "caseType", briefing: "\"first\" (age 12), \"lost\", \"damaged\" or \"update\" (change of particulars)" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "Request" },
};
