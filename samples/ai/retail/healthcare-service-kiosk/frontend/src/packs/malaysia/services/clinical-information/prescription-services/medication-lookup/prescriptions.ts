// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { HEALTH_DISCLAIMER } from "@/hospital/data";
import type { PatientRecord } from "@/hospital/records";
import type { ServiceResult } from "@/services/shared/result";

/** One row per prescription, shared by the touch step and the chat chain. */
export function prescriptionsResult(
  record: PatientRecord,
  money: (amount: number) => string,
): ServiceResult {
  return {
    title: "Your Prescriptions",
    rows: record.prescriptions.map((p) => ({
      label: p.name,
      value:
        `${p.dosage} · ${p.durationDays} days · ${money(p.price)} · ` +
        (p.lastFilled === null
          ? `prescribed today${p.prescribedBy ? ` by ${p.prescribedBy}` : ""}, ready to collect at the pharmacy`
          : `${p.refillsLeft} ${p.refillsLeft === 1 ? "refill" : "refills"} left, last filled ${p.lastFilled}`),
    })),
    note: HEALTH_DISCLAIMER,
  };
}
