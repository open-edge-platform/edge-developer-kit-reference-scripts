// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Shared by chain.ts and the touch step: what the record says the patient should see to today. */

import { payer } from "@/hospital/data";
import { isoDate, outstandingBalance, type PatientRecord } from "@/hospital/records";

export function statusNotes(record: PatientRecord, money: (amount: number) => string, today = isoDate(new Date())): string[] {
  const notes: string[] = [];
  const policy = record.policy;
  if (!policy) notes.push("No insurance on file — you're registered as self-pay.");
  else if (policy.expiry < today) notes.push(`Your ${payer(policy.payer)?.name ?? policy.payer} policy expired on ${policy.expiry} — Eligibility Check can review it.`);
  else notes.push(`Insurance: ${payer(policy.payer)?.name ?? policy.payer}, active until ${policy.expiry}.`);
  if (record.invoices.length > 0) {
    notes.push(`Outstanding balance of ${money(outstandingBalance(record))} — Outstanding Balance can settle it.`);
  }
  if (record.appointmentToday) {
    notes.push(`You have an appointment today at ${record.appointmentToday.time} — Same-Day Check-In gives you the clinic's queue number.`);
  }
  return notes;
}
