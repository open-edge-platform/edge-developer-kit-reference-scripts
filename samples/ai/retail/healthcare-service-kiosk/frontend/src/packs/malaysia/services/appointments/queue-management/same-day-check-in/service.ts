// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "checkin",
  label: "Same-Day Check-In",
  description: "Check in for your appointment today and get a queue number",
  fee: 0,
  order: 1,
  icon: "ticket",
  featured: 1,
  repeatable: true,
  documents: [],
  fields: [],
  briefingNotes: ["One check-in per appointment: a patient with two visits today checks in for each."],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Check-in" },
};
