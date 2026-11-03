// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "estimate",
  label: "Estimate Procedure Cost",
  description: "Get an estimated cost for a procedure, with or without insurance",
  fee: 0,
  order: 1,
  icon: "calculator",
  documents: [],
  fields: [
    { id: "procedureId", briefing: "the procedure to estimate — one of the catalog's procedures" },
    { id: "payer", briefing: "how the patient will pay — \"self\" for self-pay, or an insurance payer id" },
  ],
  flow: ["application", "result"],
  stepLabels: { application: "Procedure" },
};
