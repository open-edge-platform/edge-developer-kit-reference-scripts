// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { plural, formatMoney } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import type { CitizenProfile } from "@/app/api/_lib/flows/types";

/** Unpaid fines blacklist a citizen at JPJ, putting any renewal on hold. */
export function finesWarning(profile: CitizenProfile): string | null {
  const fines = profile.outstandingFines;
  if (fines.count === 0) return null;
  return (
    `Heads up: JPJ records show ${fines.count} unpaid ${plural(fines.count, "summons", "summonses")} ` +
    `totalling ${formatMoney(fines.total, CURRENCY)} — this renewal will be put on hold until they are ` +
    "settled at the Traffic Fine Payment service."
  );
}
