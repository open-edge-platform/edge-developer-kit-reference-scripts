// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "healthqa",
  label: "General Q&A",
  description: "General health questions answered from the hospital's patient guides",
  fee: 0,
  order: 1,
  icon: "question",
  documents: [],
  fields: [{ id: "question", briefing: "the patient's free-text health question" }],
  flow: ["application", "result"],
  stepLabels: { application: "Question" },
};
