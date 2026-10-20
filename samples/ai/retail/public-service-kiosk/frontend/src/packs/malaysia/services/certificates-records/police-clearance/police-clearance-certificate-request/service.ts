// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PROOF_OF_IDENTITY, supportingDocument } from "@/services/shared/flow";
import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "police",
  label: "Certificate of Good Conduct (SKB)",
  description: "KLN e-Konsular · PDRM-vetted clearance certificate, RM20",
  fee: 20,
  documents: [
    PROOF_OF_IDENTITY,
    supportingDocument(
      "Passport Photo and Bio Page",
      "Passport photo & bio page (passport ≥6 months validity)",
      ["A passport biodata page", "A passport-style photograph"],
    ),
  ],
  fields: [
    { id: "purpose", briefing: "\"studies\", \"working\", \"family\", \"pr\", \"citizenship\" or \"others\"" },
    { id: "country", briefing: "the destination country the certificate is for (free text)" },
  ],
  flow: ["consent", "identity", "application", "documents", "payment", "receipt"],
  stepLabels: { application: "Purpose" },
};
