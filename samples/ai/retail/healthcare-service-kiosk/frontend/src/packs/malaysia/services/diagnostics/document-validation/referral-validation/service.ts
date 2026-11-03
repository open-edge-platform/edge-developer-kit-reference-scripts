// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "referral",
  label: "Referral Validation",
  description: "Validate a referral letter and route it to the right specialist clinic",
  fee: 0,
  order: 1,
  icon: "file-check",
  documents: [
    {
      id: "referral",
      label: "Referral Letter",
      hint: "A letter from your GP or another hospital referring you to a specialist",
      accepts: ["A referral letter from a registered doctor or clinic"],
      holderDetails: ["name"],
      holderRole: "the patient being referred, never the referring doctor",
    },
  ],
  fields: [
    {
      id: "referralDepartment",
      briefing: "the specialist department the referral is for — read off the letter; asked only when it names none or only hints at one",
    },
    {
      id: "referralDate",
      briefing: "the date printed on the referral letter, as YYYY-MM-DD — read off the letter; asked only when unreadable or in the future",
    },
  ],
  briefingNotes: [
    "The letter is uploaded first: patient, IC, referring doctor, MMC number, clinic, date and department are read from it and checked. A referral over 6 months old, an IC or name that is not the patient's, or no referring doctor is filed for staff review, not refused.",
  ],
  flow: ["consent", "identity", "documents", "application", "payment", "receipt"],
  stepLabels: { application: "Review" },
};
