// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, conflict, notFound, readJson, unavailable } from "../_lib/http";
import { resolveScan, SCAN_FAILURE_MESSAGE } from "../_lib/patients";
import { PRINT_FAILURE_MESSAGE, PrintError, printerDriverId, printerWidthDots, printJob } from "../_lib/printer";
import { appointmentSlipTicket, patientCardTicket } from "../_lib/printouts";
import { signedSlipCode } from "../_lib/slips";

/** GET /api/print — which printer driver runs here; "off" leaves the screen's Print to the browser. */
export function GET() {
  return Response.json({ driver: printerDriverId() }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/print { code } — prints the patient card or appointment slip that
 * `code` (an MRN or a signed slip code) resolves to. Only the code comes from
 * the page: what goes on paper is read from the record, and a forged slip
 * prints nothing.
 */
export async function POST(req: Request) {
  if (printerDriverId() === "off") return conflict("this kiosk has no receipt printer", { reason: "off" });
  const { code } = await readJson<{ code: string }>(req);
  const raw = typeof code === "string" ? code.trim() : "";
  if (!raw || raw.length > 128) return badRequest("code is required");

  const resolved = await resolveScan(raw);
  if (!resolved.ok) {
    const message = SCAN_FAILURE_MESSAGE[resolved.reason];
    return resolved.reason === "unregistered"
      ? notFound(message, { reason: resolved.reason })
      : badRequest(message, { reason: resolved.reason });
  }

  const width = printerWidthDots();
  const job =
    resolved.kind === "patientCard"
      ? patientCardTicket(resolved.citizen.name, resolved.mrn, width)
      : appointmentSlipTicket(resolved.appointment, signedSlipCode(resolved.appointment.reference), width);
  try {
    await printJob(job, resolved.kind === "patientCard" ? `patient card ${resolved.mrn}` : `slip ${resolved.appointment.reference}`);
  } catch (error) {
    if (!(error instanceof PrintError)) throw error;
    console.warn(`[printer] ${error.reason}: ${error.message}`);
    return unavailable(PRINT_FAILURE_MESSAGE[error.reason], { reason: error.reason });
  }
  return Response.json({ printed: resolved.kind });
}
