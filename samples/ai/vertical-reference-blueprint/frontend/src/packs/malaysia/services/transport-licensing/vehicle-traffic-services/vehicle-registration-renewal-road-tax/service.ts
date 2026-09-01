// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "roadtax",
  label: "Road Tax Renewal (LKM)",
  description: "JPJ · e-LKM renewal — insurance is verified electronically",
  // Fallback only: the actual fee is computed from the vehicle's engine capacity (api/_lib/registry.ts).
  fee: 90,
  order: 1,
  documents: [],
  fields: [
    { id: "plate", briefing: "the vehicle to renew, one of the citizen's JPJ-registered plates (picked automatically when they own exactly one)" },
    { id: "period", briefing: "renewal period in months, \"6\" or \"12\"" },
  ],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Vehicle" },
};
