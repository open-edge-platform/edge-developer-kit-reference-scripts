// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "records",
  label: "Medical Document Intake",
  description: "Add outside lab, imaging or discharge records to your patient file",
  fee: 0,
  order: 2,
  icon: "file-up",
  repeatable: true,
  documents: [
    {
      id: "medical",
      label: "Medical Document",
      hint: "Lab or imaging reports, discharge summaries, prescriptions and other records to add to your file",
      accepts: [
        "A lab report",
        "An imaging report (X-ray, CT, MRI or ultrasound)",
        "A discharge summary",
        "A referral letter",
        "A prescription",
        "A medical certificate",
        "An insurance guarantee letter",
        "A vaccination record",
      ],
      holderDetails: ["name"],
    },
  ],
  fields: [
    {
      id: "docType",
      briefing:
        "the kind of document, recognised from the upload and always confirmed by the patient: \"lab\", \"imaging\", " +
        "\"discharge\", \"referral\", \"prescription\", \"mc\", \"gl\", \"vaccination\" or \"other\"",
    },
  ],
  briefingNotes: [
    "The document is uploaded first; the kiosk recognises what it is and asks the patient to confirm. It is then attached to the patient's medical record for their doctor to review.",
  ],
  flow: ["consent", "identity", "documents", "application", "payment", "receipt"],
  stepLabels: { application: "Confirm" },
};
