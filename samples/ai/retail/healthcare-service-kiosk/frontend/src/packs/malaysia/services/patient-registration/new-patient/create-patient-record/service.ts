// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services/types";

export const service: ServiceDefinition = {
  id: "register",
  label: "Create Patient Record",
  description: "Register as a new patient with your MyKad and get your MRN",
  fee: 0,
  order: 1,
  icon: "user-plus",
  oncePerCitizen: true,
  documents: [],
  fields: [
    { id: "detailsConfirmed", briefing: '"yes" when the details read off their MyKad are theirs, "no" when something is wrong' },
    { id: "phone", briefing: "the patient's own mobile number" },
    { id: "language", briefing: "preferred language: \"English\", \"Malay\", \"Mandarin\" or \"Tamil\"", ahead: true },
    { id: "emergencyName", briefing: "emergency contact's full name" },
    { id: "emergencyPhone", briefing: "emergency contact's phone number" },
  ],
  briefingNotes: [
    "For someone with no record yet. They tap their MyKad, its details are read off the chip and put to them to confirm — never typed — and then the camera takes their record photo.",
    "Details that aren't theirs, or no MyKad, send them to the registration counter. A MyKad that is already registered is told so: they sign in with it instead.",
  ],
  // "enroll" stands where "identity" would: there is no record to identify against yet.
  flow: ["consent", "enroll", "application", "payment", "receipt"],
  stepLabels: { enroll: "Your MyKad", application: "Details" },
};
