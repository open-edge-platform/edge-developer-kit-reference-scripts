// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "marriage",
  label: "Marriage Registration (Non-Muslim)",
  description: "JPN · Form JPN.KC02 under Act 164 — RM30 with certificate",
  // RM20 registration + RM10 certificate; outside venue adds the RM500 KC01E licence.
  fee: 30,
  pricing: { field: "venueType", rates: { office: 30, worship: 30, other: 530 } },
  documents: [
    PROOF_OF_IDENTITY,
    // A photo carries no text and a court decree omits IC numbers, so only the name can be checked.
    supportingDocument(
      "Passport Photo or Marital Status Document",
      "Passport photo (blue/white bg); divorce or death cert if previously married",
      [
        "A passport-style photograph",
        "A statutory declaration of single status (surat akuan bujang)",
        "A divorce decree or a death certificate for a former spouse",
      ],
      {
        holderDetails: ["name"],
        holderRole:
          "the applicant making the declaration, never the commissioner for oaths or registrar who witnessed it",
      },
    ),
  ],
  fields: [
    { id: "venueType", briefing: "\"office\" (JPN office), \"worship\" (house of worship) or \"other\" (home/hotel, KC01E licence)" },
    { id: "date", briefing: "the intended ceremony date" },
    { id: "witness1", briefing: "first witness's full name" },
    { id: "witness2", briefing: "second witness's full name" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "Ceremony" },
};
