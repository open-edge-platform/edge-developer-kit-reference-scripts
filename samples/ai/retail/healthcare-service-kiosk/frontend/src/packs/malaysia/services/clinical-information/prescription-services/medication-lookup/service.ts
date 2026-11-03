// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "meds",
  label: "Medication Lookup",
  description: "See your current prescriptions, dosage and refills",
  fee: 0,
  order: 1,
  icon: "pill",
  documents: [],
  fields: [],
  flow: ["consent", "identity", "application", "result"],
  stepLabels: { application: "Prescriptions" },
};
