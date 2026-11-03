// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DOCTORS, type Doctor } from "@/hospital/data";
import { addDays, availableSlots, type PatientRecord } from "@/hospital/records";

export function followUpDoctor(record: PatientRecord): Doctor | undefined {
  const followUp = record.followUp;
  if (!followUp) return undefined;
  return DOCTORS.find((d) => d.department === followUp.department && d.name === followUp.doctor);
}

/** Slots on the first 4 consulting days from a week before the recommended follow-up window. */
export function followUpSlots(record: PatientRecord, perDay = 1): { date: string; time: string }[] {
  const followUp = record.followUp;
  const doctor = followUpDoctor(record);
  if (!followUp || !doctor) return [];
  return availableSlots(doctor, addDays(new Date(), followUp.inWeeks * 7 - 7), 4, perDay);
}
