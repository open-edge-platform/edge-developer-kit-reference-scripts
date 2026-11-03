// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, readJson } from "../../_lib/http";
import { explainLabResults } from "../../_lib/lab-explain";
import { moduleOff } from "../../_lib/modules";
import { isServedPatient } from "../../_lib/served-patient";

/** POST /api/labs/explain {documentNumber} — plain-language explanations of the patient's latest lab results. */
export async function POST(req: Request) {
  const off = moduleOff("labresults");
  if (off) return off;
  const { documentNumber } = await readJson<{ documentNumber: string }>(req);
  if (typeof documentNumber !== "string" || !documentNumber.trim()) return badRequest("documentNumber is required");
  // Only the patient who verified at this terminal: the reply carries their results.
  if (!isServedPatient(documentNumber)) return Response.json({ error: "verify at this kiosk first" }, { status: 403 });
  return Response.json({ explanation: await explainLabResults(documentNumber.trim()) });
}
