// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { addMonths, isIsoDay, localDay } from "@/lib/document-fields";

/** No national rule fixes how long a referral stands; past this window staff confirm it, nothing is refused. */
export const REFERRAL_VALID_MONTHS = 6;

export type ReferralDateStatus = "ok" | "invalid" | "future" | "stale";

export function validateReferral(dateIso: string, today: Date = new Date()): ReferralDateStatus {
  if (!isIsoDay(dateIso)) return "invalid";
  const day = localDay(today);
  if (dateIso > day) return "future";
  return dateIso < addMonths(day, -REFERRAL_VALID_MONTHS) ? "stale" : "ok";
}
