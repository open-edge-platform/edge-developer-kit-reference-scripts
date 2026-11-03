// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "doctors",
  label: "Find a Doctor",
  description: "Search by specialty, language or name, then book a visit",
  fee: 0,
  order: 2,
  icon: "stethoscope",
  featured: 2,
  documents: [],
  fields: [
    { id: "department", ahead: true, briefing: "the specialty/department to search (cardiology, orthopaedics, paediatrics, obgyn, dermatology)" },
    { id: "language", ahead: true, briefing: "preferred consulting language (any language a doctor speaks, e.g. English, Malay, Mandarin, Tamil, Cantonese, Arabic, Malayalam) or \"any\"" },
    { id: "name", ahead: true, briefing: "a doctor's name, only when the patient asks for someone by name — department and language are then not needed" },
  ],
  flow: ["application"],
  stepLabels: { application: "Doctors" },
};
