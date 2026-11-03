// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "labprice",
  label: "Lab Test Pricing",
  description: "Look up the price and preparation for a lab test",
  fee: 0,
  order: 1,
  icon: "tag",
  documents: [],
  fields: [
    { id: "testId", briefing: "the lab test to price — free text matched against the catalog, or a catalog id" },
  ],
  flow: ["application", "result"],
  stepLabels: { application: "Test" },
};
