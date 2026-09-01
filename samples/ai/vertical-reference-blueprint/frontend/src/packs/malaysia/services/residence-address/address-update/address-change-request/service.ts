// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "address",
  label: "MyKad Address Change",
  description: "JPN · Required within 90 days of moving — RM10 with reprinted card",
  // A new MyKad is always printed for an address change.
  fee: 10,
  documents: [
    PROOF_OF_IDENTITY,
    {
      id: "supporting",
      label: "Proof of New Address",
      hint: "Utility bill, tenancy or S&P agreement, or penghulu/employer letter showing the new address",
      accepts: [
        "A utility bill (electricity, water, telephone) for the new home",
        "A tenancy or sale-and-purchase agreement",
        "A letter from a penghulu or employer confirming the new home",
      ],
      // A bill carries only the holder's name, not an IC number, so only the name is checked.
      holderDetails: ["name"],
      holderRole: "the account holder the bill or agreement is addressed to, never the utility company, landlord or employer issuing it",
      // The new address is read off the document, never typed, and must differ from the registry's.
      addressField: "newAddress",
      relationshipProof: {
        id: "relationship",
        label: "Proof of Relationship",
        hint: "Birth certificate naming both you and the document holder",
        // A birth certificate prints IDs that are not the applicant's, so the registry ID cross-check must not run on one.
        holderDetails: ["name"],
      },
    },
  ],
  // No application step: the new address is read off the proof document.
  fields: [],
  briefingNotes: [
    "The new address is extracted from the proof document — never ask the citizen to type it.",
  ],
  flow: ["consent", "identity", "documents", "payment", "receipt"],
};
