// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Shared by chain.ts and the touch step, so both modes refill by the same rules. */

import { payer } from "@/hospital/data";
import { isoDate, refillAmount, refillCheck, type PatientRecord, type Prescription } from "@/hospital/records";

export const NONE_ELIGIBLE =
  "None of your prescriptions can be refilled today — please see your doctor for a new prescription.";

export type RefillOption = { prescription: Prescription; ok: boolean; why?: string };

export function refillOptions(record: PatientRecord, today = new Date()): RefillOption[] {
  return record.prescriptions.map((prescription) => {
    const check = refillCheck(prescription, today);
    return check.ok
      ? { prescription, ok: true }
      : { prescription, ok: false, why: check.from ? `${check.reason}; you can refill from ${check.from}` : check.reason };
  });
}

/**
 * Who pays: an active panel policy on file with limit to spare is billed
 * directly (no payment at the kiosk); otherwise the patient pays.
 */
export function refillPayer(record: PatientRecord, ids: string, today = new Date()): { id: string; name: string } | null {
  const policy = record.policy;
  if (!policy || policy.expiry < isoDate(today)) return null;
  if (policy.remainingLimit < refillAmount(record, ids)) return null;
  const panel = payer(policy.payer);
  return panel ? { id: panel.id, name: panel.name } : null;
}
