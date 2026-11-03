// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "labresults",
  label: "Lab Results",
  description: "View your latest lab test results",
  fee: 0,
  order: 2,
  icon: "flask",
  featured: 4,
  documents: [],
  fields: [],
  flow: ["consent", "identity", "application", "result"],
  stepLabels: { application: "Results" },
};
