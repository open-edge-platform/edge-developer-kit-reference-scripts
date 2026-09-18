// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsFind, cmsFindOne, cmsUpdate } from "./cms";
import { normalizeDocumentNumber, normalizePlate } from "./normalize";

/** Vehicle ownership queries over the CMS. */

/** Shape of a `vehicles` document as returned by the CMS. */
export type VehicleDoc = {
  id: number;
  plateNumber: string;
  citizen: number;
  documentNumber: string;
  model: string;
  year: number;
  engineCc: number;
  roadTaxExpiry: string;
};

/** All vehicles registered to a citizen's IC / passport number. */
export async function findVehiclesByDocument(documentNumber: string): Promise<VehicleDoc[]> {
  const res = await cmsFind<VehicleDoc>("vehicles", {
    where: { documentNumber: { equals: normalizeDocumentNumber(documentNumber) } },
    limit: 20,
    sort: "plateNumber",
  });
  return res.docs;
}

/** A single vehicle by plate number (plates are unique in the registry). */
export function findVehicleByPlate(plateNumber: string): Promise<VehicleDoc | null> {
  return cmsFindOne<VehicleDoc>("vehicles", {
    plateNumber: { equals: normalizePlate(plateNumber) },
  });
}

/** Extend road tax by `months` from today or the current expiry, whichever is later. */
export function renewRoadTax(vehicle: VehicleDoc, months: number): Promise<VehicleDoc> {
  const base = new Date(Math.max(Date.now(), new Date(vehicle.roadTaxExpiry).getTime()));
  base.setMonth(base.getMonth() + months);
  return cmsUpdate<VehicleDoc>("vehicles", vehicle.id, { roadTaxExpiry: base.toISOString() });
}
