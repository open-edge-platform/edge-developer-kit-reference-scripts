// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { patientRecord } from "@/hospital/records";
import { barcodeDriverId, presentCode, waitForCode } from "../../_lib/barcode";
import { pickReaderCitizen } from "../../_lib/citizens";
import { badRequest, notFound, readJson, unavailable } from "../../_lib/http";
import { appointmentsToday, resolveScan, SCAN_FAILURE_MESSAGE } from "../../_lib/patients";
import { signedSlipCode } from "../../_lib/slips";

/** One long-poll of GET; the page asks again when it comes back empty. */
const WATCH_MS = 25_000;

/**
 * POST /api/identity/scan — a code from a keyboard-wedge scanner or the MRN keypad.
 * `simulate: "card" | "slip"` stands a patient's card or slip in when no scanner is fitted.
 * A code that opens a record is handed to whoever is waiting at /api/identity/document.
 */
export async function POST(req: Request) {
  const { code, simulate } = await readJson<{ code: string; simulate: "card" | "slip" }>(req);

  let raw = code?.trim() ?? "";
  if (simulate) {
    if (barcodeDriverId() !== "mock") return badRequest("a scanner is fitted — scan a real code");
    const citizen = await pickReaderCitizen();
    if (!citizen) return unavailable("citizen registry is empty — is the CMS reachable?");
    const slip = simulate === "slip" ? (await appointmentsToday(citizen))[0] : undefined;
    raw = slip ? signedSlipCode(slip.reference) : patientRecord(citizen.citizenId).mrn;
  }
  if (!raw || raw.length > 128) return badRequest("code is required");

  const resolved = await resolveScan(raw);
  if (!resolved.ok) {
    const message = SCAN_FAILURE_MESSAGE[resolved.reason];
    return resolved.reason === "unregistered"
      ? notFound(message, { reason: resolved.reason })
      : badRequest(message, { reason: resolved.reason });
  }
  presentCode(raw);
  return Response.json({ kind: resolved.kind });
}

/** One long-poll: 204 when no code came, else 200 with the code handed back to the next reader so the sign-in screen still finds it. */
export async function GET(req: Request) {
  const code = await waitForCode(WATCH_MS, req.signal);
  if (!code) return new Response(null, { status: 204 });
  presentCode(code);
  return Response.json({ heard: true });
}
