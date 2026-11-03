// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { templateExplanation } from "@/hospital/labs";
import { patientRecord } from "@/hospital/records";
import { findCitizenByDocument } from "../../_lib/citizens";
import { badRequest, conflict, notFound, readJson } from "../../_lib/http";
import { explainLabResults } from "../../_lib/lab-explain";
import { moduleOff } from "../../_lib/modules";
import { maskedEmail, notificationsOn, notify } from "../../_lib/notify";
import { isServedPatient } from "../../_lib/served-patient";
import { labResultsMessage } from "@/packs/malaysia/services/clinical-information/lab-services/lab-results/lab-results";

/** POST /api/labs/email {documentNumber} — the patient's latest results, explained, to the email on their record. */
export async function POST(req: Request) {
  const off = moduleOff("labresults");
  if (off) return off;
  const { documentNumber } = await readJson<{ documentNumber: string }>(req);
  if (typeof documentNumber !== "string" || !documentNumber.trim()) return badRequest("documentNumber is required");
  if (!isServedPatient(documentNumber)) return Response.json({ error: "verify at this kiosk first" }, { status: 403 });
  if (!notificationsOn()) return conflict("this kiosk does not send email");

  const citizen = await findCitizenByDocument(documentNumber);
  const email = citizen?.email?.trim();
  if (!citizen || !email) return notFound("there is no email address on your record — ask at the counter to add one");
  const labs = patientRecord(citizen.citizenId).labResults;
  if (!labs) return notFound("there are no lab results on your record yet");

  const explanation = (await explainLabResults(citizen.citizenId)) ?? templateExplanation(labs.results);
  const sent = await notify({
    channel: "email",
    to: email,
    subject: `Your lab results from ${labs.date}`,
    body: labResultsMessage(labs.date, labs.results, explanation),
    serviceId: "labresults",
  });
  if (!sent?.delivered) return Response.json({ error: "the email could not be sent — please try again" }, { status: 502 });
  return Response.json({ sentTo: maskedEmail(email) });
}
