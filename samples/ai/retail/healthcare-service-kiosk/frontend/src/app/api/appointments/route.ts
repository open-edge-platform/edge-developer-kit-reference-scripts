// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { findCitizenByDocument } from "../_lib/citizens";
import { badRequest, notFound, param } from "../_lib/http";
import { appointmentsToday, checkInsOf, takenSlots } from "../_lib/patients";

/**
 * GET /api/appointments?documentNumber=…  today's visits for a verified patient, and their check-in if made
 * GET /api/appointments?doctorId=…        that doctor's slots already booked by anyone
 */
export async function GET(req: Request) {
  const doctorId = param(req, "doctorId");
  if (doctorId) return Response.json({ taken: [...(await takenSlots(doctorId))] });

  const documentNumber = param(req, "documentNumber");
  if (!documentNumber) return badRequest("documentNumber or doctorId is required");
  const citizen = await findCitizenByDocument(documentNumber);
  if (!citizen) return notFound("no patient record matches that document");
  const checkIns = await checkInsOf(citizen.id);
  return Response.json({
    appointments: await appointmentsToday(citizen),
    checkedIn: checkIns[0] ?? null,
    checkIns,
  });
}
