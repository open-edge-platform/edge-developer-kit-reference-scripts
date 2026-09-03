// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsFind, cmsUpdate } from "./cms";
import type { CitizenDoc } from "./citizens";
import { normalizeDocumentNumber, normalizePlate } from "./normalize";

/** Traffic summons lookup & settlement over the CMS. */

export type FineDoc = {
  id: number;
  summonsNo: string;
  citizen: number;
  documentNumber: string;
  plateNumber: string;
  offence: string;
  amount: number;
  issuedAt: string;
  status: "unpaid" | "paid";
  /** Kiosk payment reference that settled this summons. */
  paymentId?: string;
};

export type FineLookupBy = "summons" | "plate" | "mykad";

const LOOKUP_FIELDS: Record<FineLookupBy, keyof FineDoc> = {
  summons: "summonsNo",
  plate: "plateNumber",
  mykad: "documentNumber",
};

/** The accepted `lookupBy` values, for validation messages. */
export const FINE_LOOKUP_KEYS = Object.keys(LOOKUP_FIELDS) as FineLookupBy[];

export function isFineLookupBy(value: string): value is FineLookupBy {
  return value in LOOKUP_FIELDS;
}

/** All unpaid summonses matching a summons number, plate, or IC number. */
export async function findUnpaidFines(
  lookupBy: FineLookupBy,
  reference: string,
): Promise<FineDoc[]> {
  const field = LOOKUP_FIELDS[lookupBy];
  const value =
    lookupBy === "plate" ? normalizePlate(reference) : normalizeDocumentNumber(reference);
  const res = await cmsFind<FineDoc>("fines", {
    where: { [field]: { equals: value }, status: { equals: "unpaid" } },
    limit: 50,
    sort: "issuedAt",
  });
  return res.docs;
}

export function sumFines(fines: FineDoc[]): number {
  return fines.reduce((total, fine) => total + fine.amount, 0);
}

/**
 * Mark summonses as paid and refresh the owning citizens' denormalised
 * outstanding-fine counters.
 */
export async function settleFines(fines: FineDoc[], paymentId: string): Promise<void> {
  for (const fine of fines) {
    await cmsUpdate<FineDoc>("fines", fine.id, { status: "paid", paymentId });
  }
  const citizenIds = [...new Set(fines.map((fine) => fine.citizen))];
  for (const citizenId of citizenIds) {
    const remaining = await cmsFind<FineDoc>("fines", {
      where: { citizen: { equals: citizenId }, status: { equals: "unpaid" } },
      limit: 50,
    });
    await cmsUpdate<CitizenDoc>("citizens", citizenId, {
      hasOutstandingFines: remaining.totalDocs > 0,
      unpaidFineCount: remaining.totalDocs,
      totalUnpaidAmount: sumFines(remaining.docs),
    });
  }
}
