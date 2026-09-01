// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsCreate, cmsFind, cmsUpdate } from "./cms";

/** Driving license queries over the CMS. */

export type LicenseClass = "B2" | "D" | "DA";

/** Shape of a `licenses` document as returned by the CMS. */
export type LicenseDoc = {
  id: number;
  licenseNo: string;
  citizen: number;
  documentNumber: string;
  licenseClass: LicenseClass;
  licenseType: "PDL" | "CDL";
  issuedAt: string;
  expiresAt: string;
};

/** A license expired more than 3 years is cancelled under the Road Transport Act. */
export const LICENSE_CANCELLED_AFTER_MS = 3 * 365 * 86_400_000;

export function isLicenseCancelled(license: LicenseDoc, now = Date.now()): boolean {
  return now - new Date(license.expiresAt).getTime() > LICENSE_CANCELLED_AFTER_MS;
}

/** All driving licenses held by a citizen's IC / passport number. */
export async function findLicensesByDocument(documentNumber: string): Promise<LicenseDoc[]> {
  const res = await cmsFind<LicenseDoc>("licenses", {
    where: { documentNumber: { equals: documentNumber.trim().toUpperCase() } },
    limit: 10,
    sort: "licenseClass",
  });
  return res.docs;
}

/** Extend a license by `years` from today or its current expiry, whichever is later. */
export function renewLicense(license: LicenseDoc, years: number): Promise<LicenseDoc> {
  const base = Math.max(Date.now(), new Date(license.expiresAt).getTime());
  return cmsUpdate<LicenseDoc>("licenses", license.id, {
    licenseType: "CDL",
    expiresAt: new Date(base + years * 365 * 86_400_000).toISOString(),
  });
}

/**
 * Re-issue an existing license row as a fresh 2-year probationary license,
 * optionally changing its class. Used when a cancelled license is re-applied
 * for after retaking the tests, and when a DA holder upgrades to D — the row
 * is converted in place so a citizen never holds D and DA simultaneously.
 */
export function reissueLicenseAs(license: LicenseDoc, licenseClass: LicenseClass): Promise<LicenseDoc> {
  const now = Date.now();
  return cmsUpdate<LicenseDoc>("licenses", license.id, {
    licenseClass,
    licenseType: "PDL",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 2 * 365 * 86_400_000).toISOString(),
  });
}

/** Issue a fresh 2-year probationary (P) license after a new application. */
export function issueProbationaryLicense(
  citizenDbId: number,
  documentNumber: string,
  licenseClass: LicenseClass,
): Promise<LicenseDoc> {
  const now = Date.now();
  return cmsCreate<LicenseDoc>("licenses", {
    licenseNo: `JPJ${String(now).slice(-8)}${licenseClass}`,
    citizen: citizenDbId,
    documentNumber,
    licenseClass,
    licenseType: "PDL",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 2 * 365 * 86_400_000).toISOString(),
  });
}
