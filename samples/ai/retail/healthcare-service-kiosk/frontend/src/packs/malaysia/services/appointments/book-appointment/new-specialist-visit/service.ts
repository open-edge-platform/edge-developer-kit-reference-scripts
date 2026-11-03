// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DOCTORS, SPECIALIST_DEPARTMENTS, department } from "@/hospital/data";
import type { ServiceDefinition } from "@/services/types";

/** `"cardiology" (heart checks, ECG…)` — the ids the department answer takes, with what each clinic sees. */
const clinics = SPECIALIST_DEPARTMENTS.map((id) => `"${id}" (${department(id)!.services.toLowerCase()})`).join(", ");

/** "Dr. Aisyah Rahman — cardiology, Mon/Wed/Fri, speaks English and Malay", so the agent can match a specialty, day or language to a name. */
const specialists = DOCTORS.filter((d) => SPECIALIST_DEPARTMENTS.includes(d.department))
  .map((d) => `${d.name} — ${d.department}, ${d.days.join("/")}, speaks ${d.languages.join(" and ")}`)
  .join("; ");

export const service: ServiceDefinition = {
  id: "book",
  label: "New Specialist Visit",
  description: "Book an appointment with a hospital specialist",
  fee: 0,
  order: 1,
  icon: "calendar-plus",
  repeatable: true,
  documents: [],
  fields: [
    {
      id: "doctor",
      ahead: true,
      briefing: 'the doctor the patient asked for, in their words ("Dr Lim") — the kiosk finds them and their department',
    },
    { id: "preferredDate", ahead: true, briefing: "the day the patient asked for, as YYYY-MM-DD from the calendar" },
    {
      id: "preferredTime",
      ahead: true,
      briefing: "the time the patient asked for, as 24-hour HH:MM — if free, the patient is asked to confirm it (nothing is booked until they say yes), else the closest free times are offered",
    },
    {
      id: "department",
      ahead: true,
      briefing: `the clinic the patient asked for, as one of ${clinics} — "a cardiologist" or "a heart doctor" is "cardiology"`,
    },
    { id: "doctorId", briefing: "which doctor in that department, chosen from the doctor list" },
    { id: "slot", briefing: "which appointment slot, chosen from the doctor's available slots" },
    { id: "confirmBooking", briefing: '"yes" to book the chosen slot, "change" to pick another time' },
  ],
  briefingNotes: [
    "Today can be booked: the times still ahead today come first. A day asked for with only a clinic offers just that clinic's doctors free that day.",
    "One open booking per clinic: a patient who already has one there is told when it is.",
    `Specialists: ${specialists}.`,
  ],
  flow: ["consent", "identity", "application", "payment", "receipt"],
  stepLabels: { application: "Appointment" },
};
