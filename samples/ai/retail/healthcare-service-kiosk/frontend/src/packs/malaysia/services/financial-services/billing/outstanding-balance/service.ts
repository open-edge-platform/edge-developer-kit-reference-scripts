// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "bill",
  label: "Outstanding Balance",
  description: "View unpaid invoices and settle them at the kiosk",
  fee: 0,
  order: 2,
  icon: "credit-card",
  featured: 3,
  repeatable: true,
  variableFee: true,
  kioskFee: false,
  documents: [],
  fields: [{ id: "payNow", briefing: '"now" to pay the whole balance, "later" to only see it' }],
  briefingNotes: ["The balance comes from the patient's invoices — never ask the patient for an amount."],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Invoices" },
};
