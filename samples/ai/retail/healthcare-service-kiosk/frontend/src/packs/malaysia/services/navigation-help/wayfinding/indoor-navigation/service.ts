// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "directions",
  label: "Indoor Navigation",
  description: "Directions to clinics, wards, radiology, pharmacy and more",
  fee: 0,
  order: 1,
  icon: "navigation",
  documents: [],
  fields: [{ id: "destination", briefing: "the department, ward (e.g. Ward 5A, ICU), ward room number (e.g. 5A-12) or place the visitor wants to go to" }],
  flow: ["application", "result"],
  stepLabels: { application: "Destination" },
};
