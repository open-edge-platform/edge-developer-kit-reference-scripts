// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, param } from "../_lib/http";
import { findLicensesByDocument, isLicenseCancelled } from "../_lib/licenses";

/** Driving licenses held by the verified citizen (JPJ license lookup). */
export async function GET(req: Request) {
  const documentNumber = param(req, "documentNumber");
  if (!documentNumber) return badRequest("documentNumber is required");

  const licenses = await findLicensesByDocument(documentNumber);
  await delay(600);
  return Response.json({
    licenses: licenses.map((license) => ({
      licenseNo: license.licenseNo,
      licenseClass: license.licenseClass,
      licenseType: license.licenseType,
      issuedAt: license.issuedAt,
      expiresAt: license.expiresAt,
      // Expired > 3 years: cancelled under the Road Transport Act, not renewable.
      cancelled: isLicenseCancelled(license),
    })),
  });
}
