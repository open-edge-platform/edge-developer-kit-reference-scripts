// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "fine",
  label: "Traffic Fine (Saman) Payment",
  description: "JPJ & PDRM · Look up and settle outstanding summonses",
  // Typical compound after the 50% early-payment discount (RM300 offence).
  fee: 150,
  order: 2,
  // Every saman settlement is its own transaction — never a duplicate.
  repeatable: true,
  documents: [],
  fields: [
    { id: "lookupBy", briefing: "\"summons\", \"plate\" or \"mykad\" (their own IC is searched automatically first)" },
    { id: "reference", briefing: "the summons number, plate number or MyKad number to search" },
  ],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Saman" },
};
