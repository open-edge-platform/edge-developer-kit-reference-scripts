// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { callRoute } from "../route-call";
import { GET as feesRoute } from "../../fees/route";
import { GET as finesRoute } from "../../fines/route";
import { GET as licensesRoute } from "../../licenses/route";
import { GET as vehiclesRoute } from "../../vehicles/route";

/** Typed registry lookups over the kiosk routes, for the chain specs. */

export type VehicleRecord = {
  plateNumber: string;
  model: string;
  year: number;
  engineCc: number;
  roadTaxExpiry: string;
};

export type LicenseRecord = {
  licenseNo: string;
  licenseClass: "B2" | "D" | "DA";
  licenseType: string;
  issuedAt: string;
  expiresAt: string;
  cancelled: boolean;
};

export type FineRecord = {
  summonsNo: string;
  plateNumber: string;
  offence: string;
  amount: number;
  issuedAt: string;
};

export type FineLookupResult = { fines: FineRecord[]; total: number; currency: string };

export type FeeQuote = {
  serviceId: string;
  currency: string;
  serviceFee: number;
  processingFee: number;
  total: number;
};

export async function fetchVehicles(documentNumber: string): Promise<VehicleRecord[]> {
  const res = await callRoute(vehiclesRoute, { params: { documentNumber } });
  if (!res.ok) throw new Error("the vehicle registry could not be reached");
  return (res.body as { vehicles: VehicleRecord[] }).vehicles;
}

export async function fetchLicenses(documentNumber: string): Promise<LicenseRecord[]> {
  const res = await callRoute(licensesRoute, { params: { documentNumber } });
  if (!res.ok) throw new Error("the license registry could not be reached");
  return (res.body as { licenses: LicenseRecord[] }).licenses;
}

export async function fetchFines(lookupBy: string, reference: string): Promise<FineLookupResult> {
  const res = await callRoute(finesRoute, { params: { lookupBy, reference } });
  if (!res.ok) throw new Error("the summons registry could not be reached");
  return res.body as FineLookupResult;
}

export async function fetchQuote(
  serviceId: string,
  data: Record<string, string>,
): Promise<FeeQuote> {
  const res = await callRoute(feesRoute, { params: { serviceId, ...data } });
  if (!res.ok) throw new Error("the fee quote could not be computed");
  return res.body as FeeQuote;
}
