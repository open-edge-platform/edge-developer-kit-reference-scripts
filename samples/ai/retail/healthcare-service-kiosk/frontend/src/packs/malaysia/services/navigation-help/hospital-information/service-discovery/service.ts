// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "hospitalinfo",
  label: "Service Discovery",
  description: "Find hospital services, departments, hours and general information",
  fee: 0,
  order: 1,
  icon: "hospital",
  documents: [],
  fields: [{ id: "topic", briefing: "the topic, department or free-text question the patient asked about" }],
  flow: ["application", "result"],
  stepLabels: { application: "Question" },
};
