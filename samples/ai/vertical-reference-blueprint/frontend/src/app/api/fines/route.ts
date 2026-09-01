// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, param } from "../_lib/http";
import { FINE_LOOKUP_KEYS, findUnpaidFines, isFineLookupBy, sumFines } from "../_lib/fines";
import { CURRENCY } from "../_lib/registry";

/** Look up outstanding summonses by summons number, plate, or IC number. */
export async function GET(req: Request) {
  const lookupBy = param(req, "lookupBy");
  const reference = param(req, "reference");
  if (!isFineLookupBy(lookupBy)) {
    return badRequest(`lookupBy must be one of: ${FINE_LOOKUP_KEYS.join(", ")}`);
  }
  if (!reference) return badRequest("reference is required");

  const fines = await findUnpaidFines(lookupBy, reference);
  await delay(600);
  return Response.json({
    fines: fines.map(({ summonsNo, plateNumber, offence, amount, issuedAt }) => ({
      summonsNo,
      plateNumber,
      offence,
      amount,
      issuedAt,
    })),
    total: sumFines(fines),
    currency: CURRENCY,
  });
}
