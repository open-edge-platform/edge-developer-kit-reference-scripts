// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { findCitizenByDocument } from "../_lib/citizens";
import { badRequest, notFound, param } from "../_lib/http";
import { ledgerOf } from "../_lib/ledger";
import { isServedPatient } from "../_lib/served-patient";

/**
 * GET /api/ledger?documentNumber= — what the kiosk's filings changed on the
 * patient's record (visits checked in for, invoices paid, refills dispensed, a follow-up booked),
 * for the touch screens to apply. Only for the patient verified here.
 */
export async function GET(req: Request) {
  const documentNumber = param(req, "documentNumber").toUpperCase();
  if (!documentNumber) return badRequest("documentNumber is required");
  if (!isServedPatient(documentNumber)) {
    return Response.json({ error: "verify at this kiosk first" }, { status: 403 });
  }
  const citizen = await findCitizenByDocument(documentNumber);
  if (!citizen) return notFound("no patient record matches that document");
  return Response.json(await ledgerOf(citizen), { headers: { "cache-control": "no-store" } });
}
